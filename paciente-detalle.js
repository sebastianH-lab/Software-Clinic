import { clearClientStorage, requireAuthenticatedUser, supabase } from './supabase.js'
import { validarDatosClinicosPaciente } from './validaciones-clinicas.js'

// 1. Obtener ID del paciente de la URL (?id=...)
const params = new URLSearchParams(window.location.search)
const pacienteId = params.get('id')
let comprobantesPaciente = []
let pacienteActual = null

// Verificar sesión
const user = await requireAuthenticatedUser()
if (user) {
	const profileName = user.user_metadata?.full_name || user.user_metadata?.name || user.email
	document.getElementById('profile-name').textContent = profileName
	document.getElementById('profile-avatar').textContent = profileName.trim().charAt(0).toUpperCase()
}

// Cerrar sesión
document.getElementById('logout-button').addEventListener('click', async () => {
	const { error } = await supabase.auth.signOut()
	if (error) {
		alert('No se pudo cerrar la sesión. Inténtalo de nuevo.')
		return
	}
	document.body.replaceChildren()
	clearClientStorage()
	window.location.href = 'ingresar.html'
})

// ==================== FUNCIONES AUXILIARES ====================

function calcularEdad(fecha) {
	if (!fecha) return ''
	const hoy = new Date()
	const nac = new Date(fecha)
	let edad = hoy.getFullYear() - nac.getFullYear()
	const mes = hoy.getMonth() - nac.getMonth()
	if (mes < 0 || (mes === 0 && hoy.getDate() < nac.getDate())) {
		edad--
	}
	return `${edad} años`
}

function obtenerIniciales(nombre) {
	if (!nombre) return '?'
	const p = nombre.trim().split(' ')
	return p.length === 1 ? p[0].charAt(0).toUpperCase() : (p[0].charAt(0) + p[p.length - 1].charAt(0)).toUpperCase()
}

function textoPlano(html) {
	const container = document.createElement('div')
	container.innerHTML = html || ''
	return container.textContent.trim()
}

function mostrarValor(value, suffix = '') {
	return value === null || value === undefined || value === '' ? '-' : `${value}${suffix}`
}

async function cargarUltimaAtencion() {
	if (!await requireAuthenticatedUser()) return null
	const { data: atencion, error } = await supabase.from('atenciones').select('*').eq('paciente_id', pacienteId).order('created_at', { ascending: false }).limit(1).maybeSingle()

	if (error || !atencion) return null
	if (!await requireAuthenticatedUser()) return null
	const [{ data: diagnosticos }, { data: tratamientos }] = await Promise.all([
		supabase.from('atencion_diagnosticos').select('*').eq('atencion_id', atencion.id),
		supabase.from('atencion_tratamientos').select('*').eq('atencion_id', atencion.id),
	])

	document.getElementById('latest-attention-date').textContent = new Date(atencion.created_at).toLocaleDateString('es-ES')
	const latestEditedBadge = document.getElementById('latest-attention-edited-badge')
	latestEditedBadge.hidden = !atencion.editado
	latestEditedBadge.title = atencion.fecha_edicion ? `Editado el ${new Date(atencion.fecha_edicion).toLocaleString('es-ES')}` : ''
	document.getElementById('latest-attention-body').innerHTML = `
		<p class="latest-attention-summary">${textoPlano(atencion.relato) || atencion.plan_tratamiento || 'Sin relato ni plan registrado.'}</p>
		<div class="latest-attention-meta">
			<div><small>P. arterial</small><strong>${mostrarValor(atencion.pa_presion, ' mmHg')}</strong></div>
			<div><small>F. cardiaca</small><strong>${mostrarValor(atencion.f_cardiaca, ' lpm')}</strong></div>
			<div><small>Saturación</small><strong>${mostrarValor(atencion.saturacion, ' %')}</strong></div>
			<div><small>Temperatura</small><strong>${mostrarValor(atencion.temperatura, ' °C')}</strong></div>
		</div>
		${diagnosticos?.length ? `<p class="latest-attention-summary"><strong>Diagnósticos:</strong> ${diagnosticos.map(item => `${item.descripcion}${item.cie10 ? ` (${item.cie10})` : ''}`).join(', ')}</p>` : ''}
		${atencion.plan_tratamiento ? `<p class="latest-attention-summary"><strong>Plan:</strong> ${atencion.plan_tratamiento}</p>` : ''}
		${tratamientos?.length ? `<p class="latest-attention-summary"><strong>Tratamiento:</strong> ${tratamientos.map(item => `${item.medicamento_nombre} ${item.dosis_cantidad || ''} ${item.dosis_unidad || ''}`).join(', ')}</p>` : ''}`

	return atencion
}

function renderizarArray(array, nombreIds) {
	if (!array || array.length === 0) {
		return null
	}
	return array.map(item => `<span class="tag">${item}</span>`).join('')
}

// ==================== CARGAR PERFIL DEL PACIENTE ====================

async function cargarPerfil() {
	if (!await requireAuthenticatedUser()) return
	if (!pacienteId) {
		alert("ID de paciente no encontrado")
		window.location.href = 'pacientes.html'
		return
	}

	// 2. Traer datos desde Supabase
	const { data: p, error } = await supabase
		.from('pacientes')
		.select('*')
		.eq('id', pacienteId)
		.single()

	if (error) {
		console.error("Error:", error.message)
		alert('No se encontró el paciente.')
		window.location.href = 'pacientes.html'
		return
	}
	pacienteActual = p

	// 3. Inyectar datos en la interfaz
	document.getElementById('bread-nombre').textContent = p.nombre_completo.toUpperCase()
	document.getElementById('patient-name').textContent = p.nombre_completo.toUpperCase()
	document.getElementById('patient-avatar').textContent = obtenerIniciales(p.nombre_completo)
	
	const edad = calcularEdad(p.fecha_nacimiento)
	const genero = p.genero || 'Sin género'
	document.getElementById('patient-gender-age').textContent = `${genero}, ${edad}`
	document.getElementById('patient-dni').textContent = p.documento_identidad || 'Sin DNI'
	document.getElementById('patient-email').textContent = p.correo || 'Sin correo'
	document.getElementById('archive-patient-zone').hidden = p.activo === false
	document.getElementById('restore-patient-zone').hidden = p.activo !== false

	await cargarUltimaAtencion()

	console.log('Perfil cargado:', p.nombre_completo)
}

cargarPerfil()

// ==================== PESTAÑAS DEL PERFIL ====================
const tabBtns = document.querySelectorAll('.tab-btn')
const tabPanes = document.querySelectorAll('.tab-pane')
let atencionDetalleActual = null
let diagnosticosDetalleActual = []
let tratamientosDetalleActual = []
let modoEdicionAtencion = false

function mostrarPestana(tabId) {
	tabBtns.forEach(button => {
		const isActive = button.getAttribute('aria-controls') === tabId
		button.classList.toggle('active', isActive)
		button.setAttribute('aria-selected', String(isActive))
	})
	tabPanes.forEach(pane => {
		const isActive = pane.id === tabId
		pane.hidden = !isActive
		pane.classList.toggle('active', isActive)
	})

	if (tabId === 'tab-historial') cargarHistorial()
	if (tabId === 'tab-finanzas') cargarFinanzasPaciente()
	if (tabId === 'tab-agenda') cargarAgendaPaciente(pacienteId)
}

tabBtns.forEach(button => {
	button.addEventListener('click', () => mostrarPestana(button.getAttribute('aria-controls')))
})

async function actualizarEstadoPaciente(activo) {
	const { error } = await supabase
		.from('pacientes')
		.update({ activo })
		.eq('id', pacienteId)

	if (error) {
		console.error('Error de Supabase:', error)
		alert(`${activo ? 'Hubo un error al reactivar' : 'Hubo un error al archivar'}: ${error.message}`)
		return false
	}

	return true
}

document.getElementById('delete-patient-button').addEventListener('click', async () => {
	const confirmed = window.confirm('¿Estás seguro de que deseas archivar a este paciente? Su historial quedará conservado por motivos legales y ya no aparecerá en la lista de activos.')
	if (!confirmed) return
	if (!await actualizarEstadoPaciente(false)) return

	alert('Paciente archivado correctamente.')
	window.location.href = 'pacientes.html'
})

document.getElementById('restore-patient-button').addEventListener('click', async () => {
	if (!await actualizarEstadoPaciente(true)) return

	alert('Paciente reactivado correctamente.')
	window.location.reload()
})

function normalizarEstadoCita(estado = '') {
	return estado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-') || 'pendiente'
}

function escaparHtml(value = '') {
	return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function monedaDeComprobante(value) {
	return value === 'USD' || value === 'Dólares' || value === 'D�lares' ? 'USD' : 'PEN'
}

function formatoMoneda(value, currency) {
	return `${currency === 'USD' ? '$' : 'S/.'} ${Number(value || 0).toFixed(2)}`
}

function fechaComprobante(value) {
	return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE') : '-'
}

function totalPagado(comprobante) {
	const pagos = (comprobante.comprobante_pagos || []).reduce((total, pago) => total + Number(pago.monto || 0), 0)
	return Number(comprobante.total_cancelado ?? pagos)
}

async function cargarFinanzasPaciente() {
	const content = document.getElementById('patient-finance-content')
	if (!pacienteId) return
	if (!await requireAuthenticatedUser()) return
	content.innerHTML = '<p class="empty-text">Cargando comprobantes...</p>'

	const { data, error } = await supabase
		.from('comprobantes')
		.select('*, comprobante_detalles(*), comprobante_pagos(*)')
		.eq('paciente_id', pacienteId)
		.eq('estado', 'activo')
		.order('fecha', { ascending: false })

	if (error) {
		console.error('Error al cargar las finanzas del paciente:', error.message)
		content.innerHTML = `<p class="empty-text">No se pudieron cargar los comprobantes: ${escaparHtml(error.message)}</p>`
		return
	}

	comprobantesPaciente = data || []
	const totals = {
		PEN: { billed: 0, paid: 0, pending: 0 },
		USD: { billed: 0, paid: 0, pending: 0 },
	}
	comprobantesPaciente.forEach((receipt) => {
		const currency = monedaDeComprobante(receipt.moneda)
		const paid = totalPagado(receipt)
		totals[currency].billed += Number(receipt.importe_total || 0)
		totals[currency].paid += paid
		totals[currency].pending += Number(receipt.pendiente ?? Math.max(0, Number(receipt.importe_total || 0) - paid))
	})

	const formatPair = (key) => `${formatoMoneda(totals.PEN[key], 'PEN')} · ${formatoMoneda(totals.USD[key], 'USD')}`
	document.getElementById('patient-finance-billed').textContent = formatPair('billed')
	document.getElementById('patient-finance-paid').textContent = formatPair('paid')
	document.getElementById('patient-finance-pending').textContent = formatPair('pending')
	document.getElementById('patient-receipt-count').textContent = `${comprobantesPaciente.length} ${comprobantesPaciente.length === 1 ? 'comprobante' : 'comprobantes'}`

	if (!comprobantesPaciente.length) {
		content.innerHTML = '<p class="empty-text">No hay información financiera disponible para este paciente.</p>'
		return
	}

	content.innerHTML = `<div class="patient-finance-table-wrap"><table class="patient-finance-table">
		<thead><tr><th>Fecha</th><th>Concepto / Motivo</th><th>Moneda</th><th>Monto total</th><th>Monto pagado</th><th>Pendiente</th><th>Estado</th><th>Nota de venta</th></tr></thead>
		<tbody>${comprobantesPaciente.map((receipt) => {
			const currency = monedaDeComprobante(receipt.moneda)
			const paid = totalPagado(receipt)
			const pending = Number(receipt.pendiente ?? Math.max(0, Number(receipt.importe_total || 0) - paid))
			const status = pending > 0 ? 'Pendiente' : 'Pagado'
			const details = (receipt.comprobante_detalles || []).map((detail) => detail.concepto).filter(Boolean).join(', ')
			const concept = details || receipt.motivo || 'Servicio'
			return `<tr>
				<td>${escaparHtml(fechaComprobante(receipt.fecha))}</td>
				<td>${escaparHtml(concept)}</td>
				<td>${currency === 'USD' ? 'Dólares' : 'Soles'}</td>
				<td>${escaparHtml(formatoMoneda(receipt.importe_total, currency))}</td>
				<td>${escaparHtml(formatoMoneda(paid, currency))}</td>
				<td>${escaparHtml(formatoMoneda(pending, currency))}</td>
				<td><span class="patient-receipt-status ${status.toLowerCase()}">${status}</span></td>
				<td><button class="patient-receipt-pdf" type="button" data-receipt-id="${escaparHtml(receipt.id)}">Descargar PDF</button></td>
			</tr>`
		}).join('')}</tbody>
	</table></div>`
}

function descargarNotaVenta(comprobante) {
	const JsPdf = window.jspdf?.jsPDF
	if (!JsPdf) {
		alert('No se pudo cargar el generador de PDF.')
		return
	}
	const doc = new JsPdf()
	const currency = monedaDeComprobante(comprobante.moneda)
	let y = 20
	const line = (text, size = 10) => {
		doc.setFontSize(size)
		const wrappedLines = doc.splitTextToSize(String(text), 178)
		wrappedLines.forEach((wrappedLine) => {
			if (y > 275) {
				doc.addPage()
				y = 20
			}
			doc.text(wrappedLine, 16, y)
			y += 7
		})
	}
	doc.setFontSize(20)
	doc.text('Nota de venta', 16, y)
	y += 12
	line(`Comprobante: ${comprobante.numero_comprobante || comprobante.nro_comprobante || comprobante.id}`)
	line(`Fecha de emisión: ${fechaComprobante(comprobante.fecha)}`)
	line(`Paciente: ${document.getElementById('patient-name').textContent}`)
	y += 3
	line('Conceptos', 12)
	;(comprobante.comprobante_detalles || []).forEach((detail) => {
		line(`${detail.concepto || 'Servicio'} x${detail.cantidad || 1}: ${formatoMoneda(Number(detail.cantidad || 1) * Number(detail.precio || 0), currency)}`)
	})
	if (!comprobante.comprobante_detalles?.length && comprobante.motivo) line(comprobante.motivo)
	y += 3
	line(`Motivo: ${comprobante.motivo || '-'}`)
	line(`Importe total: ${formatoMoneda(comprobante.importe_total, currency)}`)
	line(`Pagado: ${formatoMoneda(totalPagado(comprobante), currency)}`)
	line(`Pendiente: ${formatoMoneda(comprobante.pendiente ?? Math.max(0, Number(comprobante.importe_total || 0) - totalPagado(comprobante)), currency)}`)
	doc.save(`Nota_de_venta_${String(comprobante.id).slice(0, 8)}.pdf`)
}

document.getElementById('patient-finance-content').addEventListener('click', (event) => {
	const button = event.target.closest('[data-receipt-id]')
	if (!button) return
	const receipt = comprobantesPaciente.find((item) => String(item.id) === button.dataset.receiptId)
	if (receipt) descargarNotaVenta(receipt)
})

async function cargarAgendaPaciente(id) {
	if (!await requireAuthenticatedUser()) return
	const list = document.getElementById('patient-agenda-list')
	if (!id) return
	list.innerHTML = '<p class="empty-text">Cargando citas...</p>'

	const { data: citas, error } = await supabase
		.from('citas')
		.select('*')
		.eq('paciente_id', id)
		.order('fecha', { ascending: false })
		.order('hora_inicio', { ascending: false })

	if (error) {
		list.innerHTML = `<p class="empty-text">No se pudieron cargar las citas: ${escaparHtml(error.message)}</p>`
		return
	}

	document.getElementById('agenda-count').textContent = `${citas.length} ${citas.length === 1 ? 'cita' : 'citas'}`
	if (!citas.length) {
		list.innerHTML = '<p class="empty-text">No hay citas registradas para este paciente</p>'
		return
	}

	list.innerHTML = citas.map(cita => {
		const estado = cita.estado || 'Pendiente'
		const fecha = cita.fecha ? new Date(`${cita.fecha}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Fecha no registrada'
		const hora = cita.hora_inicio || '--:--'
		const horaFin = cita.hora_fin ? ` - ${cita.hora_fin}` : ''
		return `<article class="patient-appointment"><div class="patient-appointment-date">${escaparHtml(fecha)}<small>${escaparHtml(hora)}${escaparHtml(horaFin)}</small></div><div class="patient-appointment-type">${escaparHtml(cita.tipo_cita || 'Consulta')}</div><span class="appointment-status ${normalizarEstadoCita(estado)}">${escaparHtml(estado)}</span></article>`
	}).join('')
}

const drawer = document.getElementById('attention-drawer')
const backdrop = document.getElementById('attention-backdrop')
const attentionForm = document.getElementById('attention-form')
const stepButtons = document.querySelectorAll('.attention-step')
const sections = document.querySelectorAll('.attention-section')
const nextButton = document.getElementById('next-attention-button')
const diagnosisList = document.getElementById('diagnosis-list')
const treatmentList = document.getElementById('treatment-list')
const validationToast = document.getElementById('attention-validation-toast')
let currentStep = 0
const stepNames = ['anamnesis', 'examen', 'diagnostico', 'plan']

function limpiarErrorValidacion(control) {
	control.classList.remove('field-invalid')
	control.removeAttribute('aria-invalid')
}

function marcarErrorValidacion(control) {
	control.classList.add('field-invalid')
	control.setAttribute('aria-invalid', 'true')
}

function validarCamposObligatoriosAtencion() {
	const relatoEditor = document.getElementById('relato-editor')
	const planTratamiento = attentionForm.elements.plan_tratamiento
	const diagnosticos = [...document.querySelectorAll('.diagnosis-description')]
	if (!diagnosticos.length) {
		agregarDiagnostico()
		diagnosticos.push(document.querySelector('.diagnosis-description'))
	}
	const diagnosticoValido = diagnosticos.some(control => control.value.trim())
	const invalidos = []

	if (!textoPlano(relatoEditor.innerHTML).trim()) invalidos.push(relatoEditor)
	if (!diagnosticoValido) invalidos.push(diagnosticos[0])
	if (!planTratamiento.value.trim()) invalidos.push(planTratamiento)

	attentionForm.querySelectorAll('.field-invalid').forEach(limpiarErrorValidacion)
	if (!invalidos.length) return true

	attentionForm.dataset.validationAttempted = 'true'
	invalidos.forEach(marcarErrorValidacion)
	const invalidSection = invalidos[0].closest('.attention-section')
	if (invalidSection) mostrarPaso(stepNames.indexOf(invalidSection.dataset.section))
	validationToast.textContent = 'Por favor, complete todos los campos obligatorios antes de registrar la atención.'
	validationToast.classList.add('is-visible')
	window.clearTimeout(validationToast.hideTimeout)
	validationToast.hideTimeout = window.setTimeout(() => validationToast.classList.remove('is-visible'), 4000)
	invalidos[0].focus()
	return false
}

function mostrarPaso(index) {
	currentStep = index
	stepButtons.forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === index))
	sections.forEach((section, sectionIndex) => {
		section.hidden = sectionIndex !== index
		section.classList.toggle('active', sectionIndex === index)
	})
	nextButton.textContent = index === stepNames.length - 1 ? 'Guardar atención' : 'Siguiente'
}

attentionForm.addEventListener('input', event => {
	const target = event.target
	const hasText = target.id === 'relato-editor'
		? textoPlano(target.innerHTML).trim()
		: typeof target.value === 'string' && target.value.trim()
	if (target.id === 'relato-editor' || target.name === 'plan_tratamiento') {
		if (hasText) limpiarErrorValidacion(target)
		else if (attentionForm.dataset.validationAttempted) marcarErrorValidacion(target)
	}
	if (target.classList.contains('diagnosis-description')) {
		const diagnoses = [...document.querySelectorAll('.diagnosis-description')]
		if (diagnoses.some(control => control.value.trim())) {
			diagnoses.forEach(control => limpiarErrorValidacion(control))
		} else if (attentionForm.dataset.validationAttempted) {
			marcarErrorValidacion(diagnoses[0])
		}
	}
})

function abrirDrawer() {
	attentionForm.removeAttribute('data-validation-attempted')
	attentionForm.querySelectorAll('.field-invalid').forEach(limpiarErrorValidacion)
	validationToast.classList.remove('is-visible')
	drawer.classList.add('is-open')
	drawer.setAttribute('aria-hidden', 'false')
	backdrop.hidden = false
	document.body.classList.add('drawer-open')
	if (!diagnosisList.children.length) agregarDiagnostico()
	if (!treatmentList.children.length) agregarTratamiento()
}

function cerrarDrawer() {
	drawer.classList.remove('is-open')
	drawer.setAttribute('aria-hidden', 'true')
	backdrop.hidden = true
	document.body.classList.remove('drawer-open')
}

document.getElementById('new-attention-button').addEventListener('click', abrirDrawer)
document.getElementById('close-attention-button').addEventListener('click', cerrarDrawer)
document.getElementById('cancel-attention-button').addEventListener('click', cerrarDrawer)
backdrop.addEventListener('click', cerrarDrawer)
document.addEventListener('keydown', event => { if (event.key === 'Escape' && drawer.classList.contains('is-open')) cerrarDrawer() })
stepButtons.forEach((button, index) => button.addEventListener('click', () => mostrarPaso(index)))

document.querySelectorAll('.editor-toolbar button').forEach(button => {
	button.addEventListener('click', () => {
		document.execCommand(button.dataset.command, false, button.dataset.value || null)
		document.getElementById('relato-editor').focus()
	})
})

document.getElementById('attention-files').addEventListener('change', event => {
	const selectedFiles = document.getElementById('selected-files')
	selectedFiles.innerHTML = ''
	Array.from(event.target.files).forEach(file => {
		const item = document.createElement('div')
		item.className = 'selected-file'
		item.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KB)`
		selectedFiles.appendChild(item)
	})
})

function agregarDiagnostico() {
	const row = document.createElement('div')
	row.className = 'dynamic-row diagnosis-row'
	const radioName = `diagnosis-${Date.now()}-${diagnosisList.children.length}`
	row.innerHTML = `<div class="row-top"><strong>Diagnóstico</strong><button class="remove-row" type="button">Eliminar</button></div><div class="dynamic-row-grid"><label class="drawer-field">Descripción<input class="diagnosis-description" type="text" placeholder="Ej. Hipertensión arterial"></label><label class="drawer-field">Código CIE10<input class="diagnosis-code" type="text" placeholder="Ej. I10"></label></div><div class="radio-group"><label class="radio-option"><input type="radio" name="${radioName}" value="Presuntivo" checked> Presuntivo</label><label class="radio-option"><input type="radio" name="${radioName}" value="Definitivo"> Definitivo</label><label class="radio-option"><input type="radio" name="${radioName}" value="Recurrente"> Recurrente</label></div>`
	row.querySelector('.remove-row').addEventListener('click', () => row.remove())
	diagnosisList.appendChild(row)
}

function agregarTratamiento() {
	const row = document.createElement('div')
	row.className = 'dynamic-row treatment-row'
	row.innerHTML = `<div class="row-top"><strong>Medicamento</strong><button class="remove-row" type="button">Eliminar</button></div><label class="drawer-field">Nombre del medicamento<input class="treatment-name" type="text" placeholder="Ej. Amoxicilina"></label><div class="dynamic-row-grid"><label class="drawer-field">Dosis<input class="treatment-dose" type="number" min="0" step="any" placeholder="Ej. 500"></label><label class="drawer-field">Unidad<select class="treatment-unit"><option>Tableta(s)</option><option>Cápsula(s)</option><option>Ampolla(s)</option><option>mL</option><option>mg</option><option>g</option><option>Gota(s)</option></select></label><label class="drawer-field">Vía de administración<select class="treatment-route"><option>Oral</option><option>SC</option><option>IV</option><option>IM</option><option>Sublingual</option><option>Rectal</option><option>Vaginal</option><option>Oftálmica</option><option>Ótica</option><option>Nasal</option><option>Inhalatoria</option><option>Tópica</option></select></label><label class="drawer-field">Cada (horas)<input class="treatment-hours" type="number" min="0" placeholder="Ej. 8"></label><label class="drawer-field">Frecuencia (días)<input class="treatment-frequency-days" type="number" min="0" placeholder="Ej. 1"></label><label class="drawer-field">Duración (días)<input class="treatment-days" type="number" min="0" placeholder="Ej. 7"></label></div><label class="checkbox-field"><input class="treatment-habitual" type="checkbox"> Marcar como medicación habitual</label><label class="drawer-field">Información adicional / indicaciones<textarea class="treatment-notes" rows="2" placeholder="Tomar después de los alimentos..."></textarea></label>`
	row.querySelector('.remove-row').addEventListener('click', () => row.remove())
	treatmentList.appendChild(row)
}

document.getElementById('add-diagnosis-button').addEventListener('click', agregarDiagnostico)
document.getElementById('add-treatment-button').addEventListener('click', agregarTratamiento)

function obtenerDiagnosticos() {
	return Array.from(document.querySelectorAll('.diagnosis-row')).map(row => ({
		descripcion: row.querySelector('.diagnosis-description').value.trim(),
		cie10: row.querySelector('.diagnosis-code').value.trim() || null,
		tipo: row.querySelector('input[type="radio"]:checked').value,
	})).filter(item => item.descripcion)
}

function obtenerTratamientos() {
	return Array.from(document.querySelectorAll('.treatment-row')).map(row => ({
		medicamento_nombre: row.querySelector('.treatment-name').value.trim(),
		dosis_cantidad: row.querySelector('.treatment-dose').value || null,
		dosis_unidad: row.querySelector('.treatment-unit').value,
		via: row.querySelector('.treatment-route').value,
		frecuencia_horas: row.querySelector('.treatment-hours').value || null,
		frecuencia_dias: row.querySelector('.treatment-frequency-days').value || null,
		duracion_dias: row.querySelector('.treatment-days').value || null,
		es_medicacion_habitual: row.querySelector('.treatment-habitual').checked,
		informacion_adicional: row.querySelector('.treatment-notes').value.trim() || null,
	})).filter(item => item.medicamento_nombre)
}

function valorFormulario(nombre) {
	return attentionForm.elements[nombre].value.trim() || null
}

async function guardarAtencion() {
	if (!validarCamposObligatoriosAtencion()) return

	if (!pacienteActual) {
		alert('No se pudieron cargar los datos del paciente. Recargue la página antes de guardar la atención.')
		return
	}
	const validationError = validarDatosClinicosPaciente(pacienteActual)
	if (validationError) {
		alert(validationError)
		return
	}

	const { data: { user }, error: authError } = await supabase.auth.getUser()
	if (authError) {
		alert(`No se pudo verificar la sesión: ${authError.message}`)
		return
	}
	if (!user) {
		window.location.href = 'ingresar.html'
		return
	}

	nextButton.disabled = true
	nextButton.textContent = 'Guardando...'
	const archivosUrls = Array.from(document.getElementById('attention-files').files).map(file => file.name)
	const atencion = {
		paciente_id: pacienteId,
		relato: document.getElementById('relato-editor').innerHTML.trim() || null,
		archivos_urls: archivosUrls.length ? archivosUrls : null,
		pa_presion: valorFormulario('pa_presion'),
		f_cardiaca: valorFormulario('f_cardiaca'),
		f_respiratoria: valorFormulario('f_respiratoria'),
		saturacion: valorFormulario('saturacion'),
		temperatura: valorFormulario('temperatura'),
		plan_tratamiento: valorFormulario('plan_tratamiento'),
		examenes_auxiliares: valorFormulario('examenes_auxiliares'),
		registrado_por: user.id,
	}
	const { data: savedAttention, error } = await supabase.from('atenciones').insert(atencion).select('id').single()
	if (error) {
		alert(`No se pudo guardar la atención: ${error.message}`)
		nextButton.disabled = false
		nextButton.textContent = 'Guardar atención'
		return
	}
	const diagnoses = obtenerDiagnosticos().map(item => ({ ...item, atencion_id: savedAttention.id }))
	const treatments = obtenerTratamientos().map(item => ({ ...item, atencion_id: savedAttention.id }))
	if (diagnoses.length) {
		const result = await supabase.from('atencion_diagnosticos').insert(diagnoses)
		if (result.error) return manejarErrorGuardado(result.error)
	}
	if (treatments.length) {
		const result = await supabase.from('atencion_tratamientos').insert(treatments)
		if (result.error) return manejarErrorGuardado(result.error)
	}
	await actualizarFuncionesVitales(atencion)
	alert('Atención guardada correctamente.')
	attentionForm.reset()
	document.getElementById('relato-editor').innerHTML = ''
	diagnosisList.innerHTML = ''
	treatmentList.innerHTML = ''
	cerrarDrawer()
	await cargarUltimaAtencion()
	await cargarHistorial()
	nextButton.disabled = false
	nextButton.textContent = 'Siguiente'
	mostrarPaso(0)
}

function manejarErrorGuardado(error) {
	alert(`La atención se creó, pero no se pudieron guardar todos sus detalles: ${error.message}`)
	nextButton.disabled = false
	nextButton.textContent = 'Guardar atención'
}

async function actualizarFuncionesVitales(atencion) {
	const vitales = Object.fromEntries(Object.entries({
		presion_arterial: atencion.pa_presion,
		frecuencia_cardiaca: atencion.f_cardiaca,
		frecuencia_respiratoria: atencion.f_respiratoria,
		saturacion_oxigeno: atencion.saturacion,
		temperatura: atencion.temperatura,
	}).filter(([, value]) => value !== null))
	if (Object.keys(vitales).length) await supabase.from('pacientes').update(vitales).eq('id', pacienteId)
}

nextButton.addEventListener('click', () => {
	if (currentStep < stepNames.length - 1) mostrarPaso(currentStep + 1)
	else guardarAtencion()
})

async function cargarHistorial() {
	if (!await requireAuthenticatedUser()) return
	const list = document.getElementById('history-list')
	list.innerHTML = '<p class="empty-text">Cargando historial...</p>'
	const { data, error } = await supabase.from('atenciones').select('*').eq('paciente_id', pacienteId).order('created_at', { ascending: false })
	if (error) {
		list.innerHTML = `<p class="empty-text">No se pudo cargar el historial: ${error.message}</p>`
		return
	}
	document.getElementById('history-count').textContent = `${data.length} consulta${data.length === 1 ? '' : 's'}`
	if (!data.length) {
		list.innerHTML = '<p class="empty-text">Todavía no hay atenciones registradas.</p>'
		return
	}
	list.innerHTML = ''
	data.forEach(item => {
		const article = document.createElement('article')
		article.className = 'history-item'
		article.tabIndex = 0
		article.dataset.attentionId = item.id
		const header = document.createElement('div')
		header.className = 'history-item-header'
		const title = document.createElement('strong')
		title.textContent = 'Consulta médica'
		const date = document.createElement('time')
		date.textContent = new Date(item.created_at).toLocaleString('es-ES')
		header.append(title, date)
		if (item.editado) {
			const badge = document.createElement('span')
			badge.className = 'attention-edited-badge'
			badge.textContent = 'Editado'
			badge.title = item.fecha_edicion ? `Editado el ${new Date(item.fecha_edicion).toLocaleString('es-ES')}` : 'Atención modificada'
			header.appendChild(badge)
		}
		const summary = document.createElement('p')
		summary.textContent = 'Haz clic para ver el registro completo.'
		article.append(header, summary)
		list.appendChild(article)
	})
}

async function abrirDetalleAtencion(atencionId) {
	if (!await requireAuthenticatedUser()) return
	const [{ data: atencion, error: attentionError }, { data: diagnosticos, error: diagnosisError }, { data: tratamientos, error: treatmentError }] = await Promise.all([
		supabase.from('atenciones').select('*').eq('id', atencionId).single(),
		supabase.from('atencion_diagnosticos').select('*').eq('atencion_id', atencionId),
		supabase.from('atencion_tratamientos').select('*').eq('atencion_id', atencionId),
	])
	if (attentionError || diagnosisError || treatmentError || !atencion) {
		const error = attentionError || diagnosisError || treatmentError
		console.error('Error al cargar detalle de atención:', error)
		alert(`No se pudo cargar el detalle de la consulta${error?.message ? `: ${error.message}` : '.'}`)
		return
	}

	atencionDetalleActual = atencion
	diagnosticosDetalleActual = diagnosticos || []
	tratamientosDetalleActual = tratamientos || []
	renderizarDetalleAtencion()
	const modal = document.getElementById('detail-modal')
	modal.classList.add('is-open')
	modal.setAttribute('aria-hidden', 'false')
	document.getElementById('detail-modal-backdrop').hidden = false
}

function renderizarDetalleAtencion() {
	const atencion = atencionDetalleActual
	const diagnosticos = diagnosticosDetalleActual
	const tratamientos = tratamientosDetalleActual
	const content = document.getElementById('detail-modal-content')
	content.innerHTML = ''
	const editedBadge = document.getElementById('attention-edited-badge')
	editedBadge.hidden = !atencion.editado
	editedBadge.textContent = atencion.editado ? 'Editado' : ''
	editedBadge.title = atencion.fecha_edicion ? `Editado el ${new Date(atencion.fecha_edicion).toLocaleString('es-ES')}` : ''
	document.getElementById('edit-attention-button').hidden = modoEdicionAtencion
	document.getElementById('detail-modal-footer').hidden = !modoEdicionAtencion
	if (modoEdicionAtencion) {
		renderizarFormularioEdicionAtencion(content)
		return
	}

	const blocks = [
		['Anamnesis', textoPlano(atencion.relato) || 'Sin relato registrado.'],
		['Plan de tratamiento', atencion.plan_tratamiento || 'Sin plan registrado.'],
		['Exámenes auxiliares', atencion.examenes_auxiliares || 'Sin exámenes auxiliares registrados.'],
	]
	blocks.forEach(([title, text]) => {
		const block = document.createElement('section')
		block.className = 'detail-block'
		block.innerHTML = `<h3>${title}</h3>`
		const paragraph = document.createElement('p')
		paragraph.textContent = text
		block.appendChild(paragraph)
		content.appendChild(block)
	})

	const vitalsBlock = document.createElement('section')
	vitalsBlock.className = 'detail-block'
	vitalsBlock.innerHTML = '<h3>Funciones vitales</h3>'
	const vitals = document.createElement('div')
	vitals.className = 'detail-vitals'
	;[['P. arterial', atencion.pa_presion, 'mmHg'], ['F. cardiaca', atencion.f_cardiaca, 'lpm'], ['F. respiratoria', atencion.f_respiratoria, 'rpm'], ['Saturación', atencion.saturacion, '%'], ['Temperatura', atencion.temperatura, '°C']].forEach(([label, value, suffix]) => {
		const vital = document.createElement('div')
		vital.className = 'detail-vital'
		vital.innerHTML = `<small>${label}</small><strong>${mostrarValor(value, ` ${suffix}`)}</strong>`
		vitals.appendChild(vital)
	})
	vitalsBlock.appendChild(vitals)
	content.appendChild(vitalsBlock)

	const diagnosisBlock = document.createElement('section')
	diagnosisBlock.className = 'detail-block'
	diagnosisBlock.innerHTML = '<h3>Diagnósticos</h3>'
	diagnosisBlock.appendChild(crearListaDetalle(diagnosticos, item => `${item.descripcion}${item.cie10 ? ` · ${item.cie10}` : ''} · ${item.tipo}`))
	content.appendChild(diagnosisBlock)

	const treatmentBlock = document.createElement('section')
	treatmentBlock.className = 'detail-block'
	treatmentBlock.innerHTML = '<h3>Tratamiento / Receta</h3>'
	treatmentBlock.appendChild(crearListaDetalle(tratamientos, item => `${item.medicamento_nombre} · ${item.dosis_cantidad || '-'} ${item.dosis_unidad || ''} · ${item.via || '-'}`))
	content.appendChild(treatmentBlock)
}

function crearCampoEdicion(labelText, value, { multiline = false, type = 'text', step } = {}) {
	const label = document.createElement('label')
	label.className = 'attention-edit-field'
	label.textContent = labelText
	const input = document.createElement(multiline ? 'textarea' : 'input')
	if (!multiline) input.type = type
	if (step) input.step = step
	if (type === 'checkbox') input.checked = Boolean(value)
	else input.value = value ?? ''
	label.appendChild(input)
	return label
}

function crearFilaEdicion(title, values, fields) {
	const row = document.createElement('div')
	row.className = 'attention-edit-row'
	row.dataset.editRow = title
	row.dataset.recordId = values.id || ''
	const heading = document.createElement('div')
	heading.className = 'attention-edit-row-heading'
	const name = document.createElement('strong')
	name.textContent = title
	const remove = document.createElement('button')
	remove.type = 'button'
	remove.className = 'remove-row'
	remove.textContent = 'Eliminar'
	remove.addEventListener('click', () => row.remove())
	heading.append(name, remove)
	row.appendChild(heading)
	fields.forEach(([key, label, options]) => {
		const field = crearCampoEdicion(label, values[key], options)
		field.dataset.field = key
		row.appendChild(field)
	})
	return row
}

function renderizarFormularioEdicionAtencion(content) {
	const atencion = atencionDetalleActual
	const plan = document.createElement('section')
	plan.className = 'detail-block attention-edit-section'
	plan.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Plan de tratamiento' }))
	plan.appendChild(crearCampoEdicion('Plan de tratamiento', atencion.plan_tratamiento, { multiline: true }))
	plan.lastElementChild.dataset.field = 'plan_tratamiento'
	content.appendChild(plan)

	const exams = document.createElement('section')
	exams.className = 'detail-block attention-edit-section'
	exams.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Exámenes auxiliares' }))
	exams.appendChild(crearCampoEdicion('Exámenes auxiliares', atencion.examenes_auxiliares, { multiline: true }))
	exams.lastElementChild.dataset.field = 'examenes_auxiliares'
	content.appendChild(exams)

	const vitalsBlock = document.createElement('section')
	vitalsBlock.className = 'detail-block attention-edit-section'
	vitalsBlock.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Funciones vitales' }))
	const vitals = document.createElement('div')
	vitals.className = 'attention-edit-vitals'
	;[
		['pa_presion', 'Presión arterial', 'text'],
		['f_cardiaca', 'F. cardíaca', 'number'],
		['f_respiratoria', 'F. respiratoria', 'number'],
		['saturacion', 'Sat. oxígeno', 'number'],
		['temperatura', 'Temperatura', 'number'],
	].forEach(([key, label, type]) => {
		const field = crearCampoEdicion(label, atencion[key], { type, step: key === 'temperatura' ? 'any' : undefined })
		field.dataset.field = key
		vitals.appendChild(field)
	})
	vitalsBlock.appendChild(vitals)
	content.appendChild(vitalsBlock)

	const diagnosesBlock = document.createElement('section')
	diagnosesBlock.className = 'detail-block attention-edit-section'
	diagnosesBlock.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Diagnósticos' }))
	const diagnoses = document.createElement('div')
	diagnoses.className = 'attention-edit-rows'
	diagnosticosDetalleActual.forEach((item) => diagnoses.appendChild(crearFilaEdicion('Diagnóstico', item, [
		['descripcion', 'Descripción'],
		['cie10', 'Código CIE10'],
		['tipo', 'Tipo'],
	])))
	const addDiagnosis = document.createElement('button')
	addDiagnosis.type = 'button'
	addDiagnosis.className = 'add-row-button'
	addDiagnosis.textContent = '＋ Agregar diagnóstico'
	addDiagnosis.addEventListener('click', () => diagnoses.appendChild(crearFilaEdicion('Diagnóstico', { tipo: 'Presuntivo' }, [
		['descripcion', 'Descripción'],
		['cie10', 'Código CIE10'],
		['tipo', 'Tipo'],
	])))
	diagnosesBlock.append(diagnoses, addDiagnosis)
	content.appendChild(diagnosesBlock)

	const treatmentsBlock = document.createElement('section')
	treatmentsBlock.className = 'detail-block attention-edit-section'
	treatmentsBlock.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Tratamiento / Receta' }))
	const treatments = document.createElement('div')
	treatments.className = 'attention-edit-rows'
	const treatmentFields = [
		['medicamento_nombre', 'Medicamento'],
		['dosis_cantidad', 'Dosis', { type: 'number', step: 'any' }],
		['dosis_unidad', 'Unidad'],
		['via', 'Vía de administración'],
		['frecuencia_horas', 'Cada (horas)', { type: 'number' }],
		['frecuencia_dias', 'Frecuencia (días)', { type: 'number' }],
		['duracion_dias', 'Duración (días)', { type: 'number' }],
		['es_medicacion_habitual', 'Medicación habitual', { type: 'checkbox' }],
		['informacion_adicional', 'Indicaciones', { multiline: true }],
	]
	tratamientosDetalleActual.forEach((item) => treatments.appendChild(crearFilaEdicion('Medicamento', item, treatmentFields)))
	const addTreatment = document.createElement('button')
	addTreatment.type = 'button'
	addTreatment.className = 'add-row-button'
	addTreatment.textContent = '＋ Agregar tratamiento'
	addTreatment.addEventListener('click', () => treatments.appendChild(crearFilaEdicion('Medicamento', {}, treatmentFields)))
	treatmentsBlock.append(treatments, addTreatment)
	content.appendChild(treatmentsBlock)
}

function obtenerFilasEdicion(selector, fields) {
	return [...document.querySelectorAll(selector)].map((row) => {
		const item = row.dataset.recordId ? { id: row.dataset.recordId } : {}
		fields.forEach((key) => {
			const control = row.querySelector(`[data-field="${key}"] input, [data-field="${key}"] textarea`)
			const value = control?.type === 'checkbox' ? control.checked : (control?.value.trim() || null)
			item[key] = value
		})
		return item
	})
}

async function sincronizarRegistrosRelacionados(table, attentionId, rows) {
	let savedIds = []
	if (rows.length) {
		const { data, error } = await supabase.from(table).upsert(rows).select('id')
		if (error) throw error
		savedIds = (data || []).map(item => item.id)
	}

	let deleteQuery = supabase.from(table).delete().eq('atencion_id', attentionId)
	if (savedIds.length) deleteQuery = deleteQuery.not('id', 'in', `(${savedIds.join(',')})`)
	const { error: deleteError } = await deleteQuery
	if (deleteError) throw deleteError
}

function valorCampoEdicion(key) {
	const control = document.querySelector(`#detail-modal-content [data-field="${key}"] input, #detail-modal-content [data-field="${key}"] textarea`)
	return control?.value.trim() || null
}

async function guardarEdicionAtencion() {
	if (!atencionDetalleActual || !modoEdicionAtencion) return
	const { data: { user }, error: authError } = await supabase.auth.getUser()
	if (authError) {
		alert(`No se pudo verificar la sesión: ${authError.message}`)
		return
	}
	if (!user) {
		window.location.href = 'ingresar.html'
		return
	}

	const saveButton = document.getElementById('save-edit-attention')
	saveButton.disabled = true
	const payload = {
		plan_tratamiento: valorCampoEdicion('plan_tratamiento'),
		examenes_auxiliares: valorCampoEdicion('examenes_auxiliares'),
		pa_presion: valorCampoEdicion('pa_presion'),
		f_cardiaca: valorCampoEdicion('f_cardiaca'),
		f_respiratoria: valorCampoEdicion('f_respiratoria'),
		saturacion: valorCampoEdicion('saturacion'),
		temperatura: valorCampoEdicion('temperatura'),
		editado: true,
		fecha_edicion: new Date().toISOString(),
	}

	const diagnoses = obtenerFilasEdicion('.attention-edit-row[data-edit-row="Diagnóstico"]', ['descripcion', 'cie10', 'tipo'])
		.filter((item) => item.descripcion)
		.map((item) => ({ ...item, tipo: item.tipo || 'Presuntivo', atencion_id: atencionDetalleActual.id }))
	const treatments = obtenerFilasEdicion('.attention-edit-row[data-edit-row="Medicamento"]', [
		'medicamento_nombre', 'dosis_cantidad', 'dosis_unidad', 'via', 'frecuencia_horas',
		'frecuencia_dias', 'duracion_dias', 'es_medicacion_habitual', 'informacion_adicional',
	]).filter((item) => item.medicamento_nombre).map((item) => ({
		...item,
		atencion_id: atencionDetalleActual.id,
	}))

	try {
		const { data: updatedAttention, error } = await supabase
			.from('atenciones')
			.update(payload)
			.eq('id', atencionDetalleActual.id)
			.select('*')
			.single()
		if (error) throw error

		try {
			await sincronizarRegistrosRelacionados('atencion_diagnosticos', atencionDetalleActual.id, diagnoses)
		} catch (relationError) {
			throw new Error(`La atención se actualizó, pero no se pudieron sincronizar los diagnósticos: ${relationError.message}`)
		}
		try {
			await sincronizarRegistrosRelacionados('atencion_tratamientos', atencionDetalleActual.id, treatments)
		} catch (relationError) {
			throw new Error(`La atención y los diagnósticos se actualizaron, pero no se pudieron sincronizar los tratamientos: ${relationError.message}`)
		}

		atencionDetalleActual = updatedAttention
		diagnosticosDetalleActual = diagnoses
		tratamientosDetalleActual = treatments
		modoEdicionAtencion = false
		renderizarDetalleAtencion()
		await cargarUltimaAtencion()
		await cargarHistorial()
	} catch (error) {
		console.error('Error al guardar la edición de atención:', error)
		alert(`No se pudieron guardar los cambios: ${error.message}`)
	} finally {
		saveButton.disabled = false
	}
}

document.getElementById('edit-attention-button').addEventListener('click', () => {
	if (!atencionDetalleActual) return
	modoEdicionAtencion = true
	renderizarDetalleAtencion()
})
document.getElementById('cancel-edit-attention').addEventListener('click', () => {
	modoEdicionAtencion = false
	renderizarDetalleAtencion()
})
document.getElementById('save-edit-attention').addEventListener('click', guardarEdicionAtencion)

function crearListaDetalle(items = [], formatter) {
	const list = document.createElement('ul')
	list.className = 'detail-list'
	if (!items.length) {
		const empty = document.createElement('li')
		empty.textContent = 'Sin registros.'
		list.appendChild(empty)
		return list
	}
	items.forEach(item => {
		const row = document.createElement('li')
		row.textContent = formatter(item)
		list.appendChild(row)
	})
	return list
}

function cerrarDetalleAtencion() {
	const modal = document.getElementById('detail-modal')
	modal.classList.remove('is-open')
	modal.setAttribute('aria-hidden', 'true')
	document.getElementById('detail-modal-backdrop').hidden = true
	modoEdicionAtencion = false
}

document.getElementById('history-list').addEventListener('click', event => {
	const item = event.target.closest('.history-item')
	if (item) abrirDetalleAtencion(item.dataset.attentionId)
})
document.getElementById('history-list').addEventListener('keydown', event => {
	if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('history-item')) {
		event.preventDefault()
		abrirDetalleAtencion(event.target.dataset.attentionId)
	}
})
document.getElementById('close-detail-modal').addEventListener('click', cerrarDetalleAtencion)
document.getElementById('detail-modal-backdrop').addEventListener('click', cerrarDetalleAtencion)
document.addEventListener('keydown', event => { if (event.key === 'Escape') cerrarDetalleAtencion() })
