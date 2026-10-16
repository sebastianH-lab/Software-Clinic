import { clearClientStorage, requireAuthenticatedUser, supabase } from './supabase.js'

const user = await requireAuthenticatedUser('../ingresar.html')

const $ = (selector) => document.querySelector(selector)
const serviceState = { items: [] }
let profileColumns = ['id', 'full_name', 'cmp', 'specialty', 'phone']
let toastTimer

function notify(message, isError = false) {
	const toast = $('#settings-toast')
	toast.textContent = message
	toast.classList.toggle('is-error', isError)
	toast.classList.add('is-visible')
	window.clearTimeout(toastTimer)
	toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3500)
}

function money(value, currency) {
	return `${currency === 'USD' ? '$' : 'S/.'} ${Number(value || 0).toFixed(2)}`
}

function activateTab(tabName) {
	document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
		const active = tab.dataset.settingsTab === tabName
		tab.classList.toggle('is-active', active)
		tab.setAttribute('aria-selected', String(active))
	})
	document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
		panel.hidden = panel.id !== `tab-${tabName}`
	})
	window.history.replaceState({}, '', `ajustes.html#${tabName}`)
}

async function loadProfile() {
	const selects = [
		'id, full_name, cmp, specialty, phone',
		'id, full_name, cmp, especialidad, telefono',
		'id, full_name, cmp',
		'id, full_name',
		'id, nombre_completo, cmp, specialty, phone',
		'id, nombre_completo, cmp, especialidad, telefono',
		'id, nombre_completo, cmp',
		'id, nombre_completo',
	]
	let data
	let lastError
	let loaded = false
	for (const columns of selects) {
		const result = await supabase.from('profiles').select(columns).eq('id', user.id).maybeSingle()
		if (!result.error) {
			data = result.data
			profileColumns = columns.split(',').map((column) => column.trim())
			loaded = true
			break
		}
		lastError = result.error
		if (result.error.code !== '42703' && result.error.code !== 'PGRST204') throw result.error
	}
	if (!loaded) throw lastError
	const name = data?.full_name || data?.nombre_completo || user.user_metadata?.full_name || user.user_metadata?.name || ''
	$('#profile-full-name').value = name
	$('#profile-cmp').value = data?.cmp || ''
	$('#profile-specialty').value = data?.specialty || data?.especialidad || ''
	$('#profile-phone').value = data?.phone || data?.telefono || ''
	$('#profile-email').value = user.email || ''
	$('#sidebar-name').textContent = name || user.email || 'Usuario'
	$('#sidebar-avatar').textContent = (name || user.email || '?').trim().charAt(0).toUpperCase()
}

async function saveProfile(event) {
	event.preventDefault()
	const fullName = $('#profile-full-name').value.trim()
	if (!fullName) {
		notify('Ingresa tu nombre completo.', true)
		return
	}
	const nameColumn = profileColumns.includes('full_name') ? 'full_name' : 'nombre_completo'
	const payload = { id: user.id, [nameColumn]: fullName }
	if (profileColumns.includes('cmp')) payload.cmp = $('#profile-cmp').value.trim() || null
	if (profileColumns.includes('specialty')) payload.specialty = $('#profile-specialty').value.trim() || null
	else if (profileColumns.includes('especialidad')) payload.especialidad = $('#profile-specialty').value.trim() || null
	if (profileColumns.includes('phone')) payload.phone = $('#profile-phone').value.trim() || null
	else if (profileColumns.includes('telefono')) payload.telefono = $('#profile-phone').value.trim() || null
	const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
	if (error) {
		console.error('No se pudo guardar el perfil:', error)
		notify(`No se pudo guardar el perfil: ${error.message}`, true)
		return
	}
	$('#sidebar-name').textContent = fullName
	$('#sidebar-avatar').textContent = fullName.charAt(0).toUpperCase()
	notify('Cambios guardados exitosamente')
}

async function loadClinic() {
	const { data, error } = await supabase.from('clinic_settings')
		.select('name, ruc_dni, direccion, ciudad, logo_url')
		.eq('registrado_por', user.id)
		.maybeSingle()
	if (error) throw error
	if (!data) return
	$('#clinic-name').value = data.name || ''
	$('#clinic-tax-id').value = data.ruc_dni || ''
	$('#clinic-address').value = data.direccion || ''
	$('#clinic-city').value = data.ciudad || ''
	if (data.logo_url) {
		$('#clinic-logo-preview').src = data.logo_url
		$('#clinic-logo-preview').hidden = false
	}
}

async function uploadLogo(file) {
	if (!file) return null
	if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
		throw new Error('El logotipo debe ser una imagen de máximo 2 MB.')
	}
	const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
	const path = `${user.id}/logo-${Date.now()}.${extension}`
	const { error } = await supabase.storage.from('clinic-assets').upload(path, file, {
		upsert: true,
		contentType: file.type,
	})
	if (error) throw error
	const { data } = supabase.storage.from('clinic-assets').getPublicUrl(path)
	return data.publicUrl
}

async function saveClinic(event) {
	event.preventDefault()
	const submit = event.submitter
	submit.disabled = true
	try {
		const payload = {
			registrado_por: user.id,
			name: $('#clinic-name').value.trim(),
			ruc_dni: $('#clinic-tax-id').value.trim() || null,
			direccion: $('#clinic-address').value.trim() || null,
			ciudad: $('#clinic-city').value.trim() || null,
		}
		if (!payload.name) {
			notify('Ingresa el nombre de la clínica o marca.', true)
			return
		}
		const file = $('#clinic-logo').files[0]
		const logoUrl = await uploadLogo(file)
		if (logoUrl) payload.logo_url = logoUrl
		const { error } = await supabase.from('clinic_settings').upsert(payload, { onConflict: 'registrado_por' })
		if (error) throw error
		if (logoUrl) {
			$('#clinic-logo-preview').src = logoUrl
			$('#clinic-logo-preview').hidden = false
			$('#clinic-logo').value = ''
		}
		notify('Cambios guardados exitosamente')
	} catch (error) {
		console.error('No se pudieron guardar los datos del consultorio:', error)
		notify(`No se pudieron guardar los datos del consultorio: ${error.message}`, true)
	} finally {
		submit.disabled = false
	}
}

function escapeHtml(value = '') {
	return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function renderServices() {
	const list = $('#service-list')
	if (!serviceState.items.length) {
		list.innerHTML = '<tr><td colspan="5" class="service-empty">Todavía no hay servicios. Agrega el primero para crear tu catálogo.</td></tr>'
		return
	}
	list.innerHTML = serviceState.items.map((service) => `<tr><td>${escapeHtml(service.name)}</td><td>${escapeHtml(service.category || '-')}</td><td>${service.currency === 'USD' ? 'Dólares' : 'Soles'}</td><td>${money(service.price, service.currency)}</td><td><button class="secondary-button" data-edit-service="${escapeHtml(service.id)}" type="button">Editar</button><button class="secondary-button" data-delete-service="${escapeHtml(service.id)}" type="button">Eliminar</button></td></tr>`).join('')
}

async function loadServices() {
	const { data, error } = await supabase.from('service_catalog')
		.select('id, name, category, currency, price')
		.eq('registrado_por', user.id)
		.order('name')
	if (error) throw error
	serviceState.items = data || []
	renderServices()
}

function openServiceForm(service = null) {
	$('#service-form').hidden = false
	$('#service-id').value = service?.id || ''
	$('#service-name').value = service?.name || ''
	$('#service-category').value = service?.category || ''
	$('#service-currency').value = service?.currency || 'PEN'
	$('#service-price').value = service?.price ?? ''
	$('#service-name').focus()
}

async function saveService(event) {
	event.preventDefault()
	const name = $('#service-name').value.trim()
	const price = Number($('#service-price').value)
	if (!name || $('#service-price').value === '' || !Number.isFinite(price) || price < 0) {
		notify('Completa el concepto y un precio válido.', true)
		return
	}
	const id = $('#service-id').value
	const payload = {
		registrado_por: user.id,
		name,
		category: $('#service-category').value.trim() || null,
		currency: $('#service-currency').value,
		price,
	}
	const result = id
		? await supabase.from('service_catalog').update(payload).eq('id', id).eq('registrado_por', user.id)
		: await supabase.from('service_catalog').insert(payload)
	if (result.error) {
		console.error('No se pudo guardar el servicio:', result.error)
		notify(`No se pudo guardar el servicio: ${result.error.message}`, true)
		return
	}
	$('#service-form').reset()
	$('#service-id').value = ''
	$('#service-form').hidden = true
	await loadServices()
	notify('Cambios guardados exitosamente')
}

async function deleteService(id) {
	if (!window.confirm('¿Eliminar este servicio del catálogo?')) return
	const { error } = await supabase.from('service_catalog').delete().eq('id', id).eq('registrado_por', user.id)
	if (error) {
		console.error('No se pudo eliminar el servicio:', error)
		notify(`No se pudo eliminar el servicio: ${error.message}`, true)
		return
	}
	await loadServices()
	notify('Servicio eliminado')
}

async function changePassword(event) {
	event.preventDefault()
	const currentPassword = $('#current-password').value
	const newPassword = $('#new-password').value
	if (!currentPassword || !newPassword || newPassword !== $('#confirm-password').value) {
		notify('Verifica que ambas contraseñas coincidan.', true)
		return
	}
	if (newPassword.length < 8) {
		notify('La nueva contraseña debe tener al menos 8 caracteres.', true)
		return
	}
	const { error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
	if (signInError) {
		notify('La contraseña actual no es correcta.', true)
		return
	}
	const { error } = await supabase.auth.updateUser({ password: newPassword })
	if (error) {
		console.error('No se pudo actualizar la contraseña:', error)
		notify(`No se pudo actualizar la contraseña: ${error.message}`, true)
		return
	}
	$('#password-form').reset()
	notify('Cambios guardados exitosamente')
}

function bindEvents() {
	document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
		tab.addEventListener('click', () => activateTab(tab.dataset.settingsTab))
	})
	$('#profile-form').addEventListener('submit', saveProfile)
	$('#clinic-form').addEventListener('submit', saveClinic)
	$('#password-form').addEventListener('submit', changePassword)
	$('#show-service-form').addEventListener('click', () => openServiceForm())
	$('#cancel-service').addEventListener('click', () => { $('#service-form').reset(); $('#service-id').value = ''; $('#service-form').hidden = true })
	$('#service-form').addEventListener('submit', saveService)
	$('#service-list').addEventListener('click', (event) => {
		const edit = event.target.closest('[data-edit-service]')
		const remove = event.target.closest('[data-delete-service]')
		if (edit) openServiceForm(serviceState.items.find((item) => String(item.id) === edit.dataset.editService))
		if (remove) deleteService(remove.dataset.deleteService)
	})
	$('#clinic-logo').addEventListener('change', (event) => {
		const file = event.target.files[0]
		if (file) $('#clinic-logo-preview').src = URL.createObjectURL(file)
		$('#clinic-logo-preview').hidden = !file
	})
	$('#sidebar-logout').addEventListener('click', async () => {
		const { error } = await supabase.auth.signOut()
		if (error) {
			notify(`No se pudo cerrar la sesión: ${error.message}`, true)
			return
		}
		document.body.replaceChildren()
		clearClientStorage()
		window.location.href = '../ingresar.html'
	})
}

async function init() {
	bindEvents()
	const initialTab = window.location.hash.slice(1)
	if (['perfil', 'consultorio', 'servicios', 'seguridad'].includes(initialTab)) activateTab(initialTab)
	const loads = [
		['perfil', loadProfile, 'No se pudo cargar el perfil'],
		['consultorio', loadClinic, 'No se pudieron cargar los datos del consultorio'],
		['servicios', loadServices, 'No se pudo cargar el catálogo de servicios'],
	]
	await Promise.all(loads.map(async ([section, load, message]) => {
		try {
			await load()
		} catch (error) {
			console.error(`${message}:`, error)
			if (section === 'servicios') {
				$('#service-list').innerHTML = `<tr><td colspan="5" class="service-empty">${escapeHtml(message)}: ${escapeHtml(error.message)}</td></tr>`
			}
			notify(`${message}: ${error.message}`, true)
		}
	}))
}

if (user) init()
