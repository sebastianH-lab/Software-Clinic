import { clearClientStorage, requireAuthenticatedUser, supabase } from './supabase.js'

const state = { receipts: [], filteredReceipts: [], patients: [], doctors: [], services: [], selectedPatient: null, selectedReceipt: null, proformas: [], filteredProformas: [], selectedProforma: null, proformaPatient: null, proformaConcepts: [], proformaStage: 0, stage: 0, editing: false, showDeleted: false, concepts: [], payments: [], page: 1, pageSize: 10, sortAscending: false, filters: { from: '', to: '' }, proformaFilters: { from: '', to: '' } }
const legacyViewSelectors = { '#finance-list-view': '#tab-comprobantes', '#comprobantes-view': '#tab-comprobantes', '#income-view': '#tab-ingresos', '#expense-view': '#tab-egresos', '#proforma-view': '#tab-proformas' }
const $ = (selector) => document.querySelector(legacyViewSelectors[selector] || selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const today = () => new Date().toISOString().slice(0, 10)
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
const calculateAge = (birthDate) => { if (!birthDate) return 'Edad no registrada'; const birth = new Date(birthDate); const current = new Date(); let result = current.getFullYear() - birth.getFullYear(); if (current < new Date(current.getFullYear(), birth.getMonth(), birth.getDate())) result--; return `${result} años` }
const money = (value, currency) => `${currency === 'USD' || currency === 'Dólares' || currency === 'D�lares' ? '$' : 'S/.'} ${Number(value || 0).toFixed(2)}`
const dateDisplay = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE') : '-'
const showToast = (message) => { const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); window.setTimeout(() => toast.classList.remove('is-visible'), 3200) }

async function loadPatients() { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; const { data, error } = await supabase.from('pacientes').select('*').eq('registrado_por', user.id).eq('activo', true).order('nombre_completo'); if (error) { console.error(error); showToast('No se pudieron cargar los pacientes'); return } state.patients = data || []; renderPatientPicker() }
async function loadDoctors() { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name'); if (error) { console.error('No se pudieron cargar los médicos:', error); showToast(`No se pudieron cargar los médicos: ${error.message}`) } state.doctors = data || []; const doctorOptions = `<option value="">Sin asignar</option>${state.doctors.map((doctor) => `<option value="${escapeHtml(doctor.id)}">${escapeHtml(doctor.full_name || 'Doctor')}</option>`).join('')}`; $('#receipt-doctor').innerHTML = doctorOptions; $('#proforma-doctor').innerHTML = doctorOptions; const profile = state.doctors.find((doctor) => doctor.id === user.id); const name = profile?.full_name || user.user_metadata?.full_name || user.email || 'Usuario activo'; $('#sidebar-name').textContent = name; $('#sidebar-avatar').textContent = initials(name) }
async function loadServiceCatalog() {
	const user = await requireAuthenticatedUser('../ingresar.html')
	if (!user) return
	const { data, error } = await supabase.from('service_catalog')
		.select('id, name, category, currency, price')
		.eq('registrado_por', user.id)
		.order('name')
	if (error) throw error
	state.services = data || []
	$('#service-catalog-options').innerHTML = state.services.map((service) =>
		`<option value="${escapeHtml(service.name)}" label="${escapeHtml(`${service.currency} ${Number(service.price).toFixed(2)}`)}"></option>`,
	).join('')
}
function applyCatalogPrice(concept, input, currency) {
	const service = state.services.find((item) =>
		item.name.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase() && item.currency === currency,
	)
	if (!service) return
	concept.concepto = service.name
	concept.precio = Number(service.price)
	input.closest('[data-index]').querySelector('[data-field="precio"], [data-proforma-field="precio"]').value = String(service.price)
	updateTotals()
	updateProformaTotals()
}
async function loadReceipts() { try { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; let query = supabase.from('comprobantes').select('*, paciente:pacientes(nombre_completo, documento_identidad, genero, fecha_nacimiento), doctor:profiles(full_name)').eq('registrado_por', user.id).eq('estado', state.showDeleted ? 'eliminado' : 'activo').order('fecha', { ascending: false }); if (state.filters.from) query = query.gte('fecha', state.filters.from); if (state.filters.to) query = query.lte('fecha', state.filters.to); const { data, error } = await query; if (error) throw error; state.receipts = await Promise.all((data || []).map(async (receipt) => { const [{ data: details }, { data: payments }] = await Promise.all([supabase.from('comprobante_detalles').select('*').eq('comprobante_id', receipt.id), supabase.from('comprobante_pagos').select('*').eq('comprobante_id', receipt.id)]); return { ...receipt, details: details || [], payments: payments || [] } })); applyReceiptFilters() } catch (error) { console.error('Error al cargar comprobantes:', error); showToast(`No se pudieron cargar los comprobantes: ${error.message}`) } }

function proformaStatus(proforma) {
	if (['pendiente', 'aprobada'].includes(proforma.estado) && proforma.fecha && proforma.validez_dias) {
		const expiration = new Date(`${String(proforma.fecha).slice(0, 10)}T12:00:00`)
		expiration.setDate(expiration.getDate() + Number(proforma.validez_dias))
		if (expiration < new Date(`${today()}T00:00:00`)) return 'vencida'
	}
	return proforma.estado || 'pendiente'
}

async function loadProformas() {
	try {
		const user = await requireAuthenticatedUser('../ingresar.html')
		if (!user) return
		let query = supabase.from('proformas')
			.select('*, paciente:pacientes(nombre_completo, documento_identidad), medico:profiles(full_name)')
			.eq('registrado_por', user.id)
			.order('fecha', { ascending: false })
		if (state.proformaFilters.from) query = query.gte('fecha', state.proformaFilters.from)
		if (state.proformaFilters.to) query = query.lte('fecha', state.proformaFilters.to)
		const { data, error } = await query
		if (error) throw error
		state.proformas = await Promise.all((data || []).map(async (proforma) => {
			const { data: details, error: detailsError } = await supabase.from('proforma_detalles').select('*').eq('proforma_id', proforma.id)
			if (detailsError) throw detailsError
			return { ...proforma, details: details || [] }
		}))
		const expired = state.proformas.filter((proforma) => ['pendiente', 'aprobada'].includes(proforma.estado) && proformaStatus(proforma) === 'vencida')
		if (expired.length) {
			const { error: expiryError } = await supabase.from('proformas').update({ estado: 'vencida' }).eq('registrado_por', user.id).in('id', expired.map((item) => item.id)).in('estado', ['pendiente', 'aprobada'])
			if (expiryError) throw expiryError
			expired.forEach((item) => { item.estado = 'vencida' })
		}
		applyProformaFilters()
	} catch (error) {
		console.error('Error al cargar proformas:', error)
		showToast(`No se pudieron cargar las proformas: ${error.message}`)
	}
}

function applyProformaFilters() {
	const term = ($('#proforma-search')?.value || '').trim().toLocaleLowerCase()
	const field = $('#proforma-search-field')?.value || 'patient'
	state.filteredProformas = state.proformas.filter((proforma) => {
		if (!term) return true
		const value = field === 'concept'
			? proforma.details.map((detail) => detail.concepto).join(' ')
			: proforma.paciente?.nombre_completo
		return String(value || '').toLocaleLowerCase().includes(term)
	})
	renderProformas()
	renderProformaKpis()
}

function renderProformaKpis() {
	const totals = state.proformas.reduce((result, proforma) => {
		const currency = proforma.moneda === 'USD' ? 'USD' : 'PEN'
		const amount = Number(proforma.importe_total || 0)
		result[currency] += amount
		if (proformaStatus(proforma) === 'pendiente') result[`${currency}Pending`] += amount
		if (proformaStatus(proforma) === 'convertida') result[`${currency}Converted`] += amount
		return result
	}, { PEN: 0, USD: 0, PENPending: 0, USDPending: 0, PENConverted: 0, USDConverted: 0 })
	$('#kpi-proforma-pen').textContent = money(totals.PEN, 'PEN')
	$('#kpi-proforma-pending').textContent = money(totals.PENPending, 'PEN')
	$('#kpi-proforma-pending-usd').textContent = money(totals.USDPending, 'USD')
	$('#kpi-proforma-usd').textContent = money(totals.USD, 'USD')
	$('#kpi-proforma-converted').textContent = money(totals.PENConverted, 'PEN')
	$('#kpi-proforma-converted-usd').textContent = money(totals.USDConverted, 'USD')
}

function renderProformas() {
	$('#proforma-count').textContent = `${state.filteredProformas.length} ${state.filteredProformas.length === 1 ? 'registro' : 'registros'}`
	$('#proforma-list').innerHTML = state.filteredProformas.length ? state.filteredProformas.map((proforma) => {
		const status = proformaStatus(proforma)
		const canConvert = status === 'pendiente' || status === 'aprobada'
		return `<div class="proforma-table"><span>${escapeHtml(proforma.paciente?.nombre_completo || 'Paciente')}</span><span>${dateDisplay(proforma.fecha)}</span><span>${escapeHtml(proforma.details.map((detail) => `${detail.concepto} x${detail.cantidad}`).join(', ') || '-')}</span><span>${escapeHtml(proforma.medico?.full_name || 'Sin asignar')}</span><span>${proforma.moneda === 'USD' ? 'Dólares' : 'Soles'}</span><span>${money(proforma.importe_total, proforma.moneda)}</span><span><em class="proforma-status ${escapeHtml(status)}">${escapeHtml(status)}</em></span><span class="proforma-actions"><button type="button" data-proforma-detail="${escapeHtml(proforma.id)}">Ver detalle</button>${status === 'pendiente' ? `<button type="button" data-proforma-approve="${escapeHtml(proforma.id)}">Aprobar</button>` : ''}<button class="convert-proforma" type="button" data-convert-proforma="${escapeHtml(proforma.id)}" ${canConvert ? '' : 'disabled'}>${status === 'convertida' ? 'Convertida' : 'Convertir a Comprobante'}</button></span></div>`
	}).join('') : '<div class="finance-empty"><span>▱</span><strong>No se encontraron proformas</strong><small>Usa “Nueva proforma” para crear una cotización.</small></div>'
}

function proformaSubtotal() {
	return state.proformaConcepts.reduce((sum, concept) => sum + Number(concept.cantidad || 0) * Number(concept.precio || 0), 0)
}

function updateProformaTotals() {
	const subtotal = proformaSubtotal()
	const total = Math.max(0, subtotal - Number($('#proforma-discount-base').value || 0) + Number($('#proforma-igv').value || 0) - Number($('#proforma-discount-total').value || 0))
	$('#proforma-subtotal').textContent = subtotal.toFixed(2)
	$('#proforma-total').textContent = total.toFixed(2)
}

function renderProformaConcepts() {
	$('#proforma-concept-list').innerHTML = `<div class="concepts-head"><span>Concepto</span><span>Cantidad</span><span>Monto base</span><span>Precio</span><span></span></div>${state.proformaConcepts.map((concept, index) => `<div class="proforma-concept-row" data-index="${index}"><input data-proforma-field="concepto" list="service-catalog-options" value="${escapeHtml(concept.concepto)}" placeholder="Servicio" aria-label="Concepto"><input data-proforma-field="cantidad" type="number" min="1" step="1" value="${concept.cantidad}" aria-label="Cantidad"><input data-proforma-field="monto_base" type="number" min="0" step="0.01" value="${concept.monto_base}" aria-label="Monto base"><input data-proforma-field="precio" type="number" min="0" step="0.01" value="${concept.precio}" aria-label="Precio"><button class="delete-row" data-remove-proforma-concept="${index}" type="button" aria-label="Eliminar concepto">⌫</button></div>`).join('')}`
}

function selectProformaPatient(id) {
	state.proformaPatient = state.patients.find((patient) => String(patient.id) === String(id)) || null
	if (!state.proformaPatient) return
	$('#proforma-selected-patient').innerHTML = `${escapeHtml(state.proformaPatient.nombre_completo)}<small>${escapeHtml(state.proformaPatient.documento_identidad || 'DNI no registrado')}</small>`
	$('#proforma-patient-stage').hidden = true
	$('#proforma-data-stage').hidden = false
	state.proformaStage = 1
	$('#proforma-drawer-title').textContent = 'Datos de la cotización'
	$('#next-proforma-stage').textContent = 'Conceptos →'
	$('#proforma-date').value = today()
}

function openProformaDrawer() {
	state.proformaPatient = null
	state.proformaStage = 0
	state.proformaConcepts = [{ concepto: '', cantidad: 1, monto_base: 0, precio: 0 }]
	$('#proforma-patient-search').value = ''
	$('#proforma-validity').value = '15'
	$('#proforma-currency').value = 'PEN'
	$('#proforma-discount-base').value = '0'
	$('#proforma-discount-total').value = '0'
	$('#proforma-igv').value = '0'
	$('#proforma-patient-stage').hidden = false
	$('#proforma-data-stage').hidden = true
	$('#proforma-concepts-stage').hidden = true
	$('#proforma-drawer-title').textContent = 'Selecciona un paciente'
	$('#back-proforma-stage').hidden = true
	$('#next-proforma-stage').textContent = 'Datos →'
	renderProformaPatientPicker()
	renderProformaConcepts()
	updateProformaTotals()
	$('#proforma-drawer').hidden = false
}

function renderProformaPatientPicker() {
	const term = ($('#proforma-patient-search').value || '').trim().toLocaleLowerCase()
	const criterion = $('#proforma-patient-criterion').value
	const patients = state.patients.filter((patient) => String(patient[criterion] || '').toLocaleLowerCase().includes(term))
	$('#proforma-patient-picker').innerHTML = patients.length ? patients.map((patient) => `<button class="patient-option" data-proforma-patient-id="${escapeHtml(patient.id)}" type="button"><span class="patient-avatar">${initials(patient.nombre_completo)}</span><span><strong>${escapeHtml(patient.nombre_completo || 'Sin nombre')}</strong><small>DNI ${escapeHtml(patient.documento_identidad || 'N/D')}</small></span></button>`).join('') : '<div class="finance-empty"><strong>No encontramos pacientes</strong></div>'
}

function closeProformaDrawer() { $('#proforma-drawer').hidden = true }

function setProformaStage(stage) {
	if (stage === 1 && !state.proformaPatient) { showToast('Selecciona un paciente para continuar'); return }
	if (stage === 2 && (!$('#proforma-date').value || Number($('#proforma-validity').value) < 1)) { showToast('Completa una fecha y una validez mayor a cero'); return }
	$('#proforma-patient-stage').hidden = stage !== 0
	$('#proforma-data-stage').hidden = stage !== 1
	$('#proforma-concepts-stage').hidden = stage !== 2
	state.proformaStage = stage
	$('#proforma-drawer-title').textContent = ['Selecciona un paciente', 'Datos de la cotización', 'Conceptos y descuentos'][stage]
	$('#back-proforma-stage').hidden = stage !== 2
	$('#next-proforma-stage').textContent = stage === 0 ? 'Datos →' : stage === 1 ? 'Conceptos →' : 'Guardar proforma'
}

function bindProformaEvents() {
	$('#new-proforma').addEventListener('click', openProformaDrawer)
	$('#close-proforma-drawer').addEventListener('click', closeProformaDrawer)
	$('#cancel-proforma').addEventListener('click', closeProformaDrawer)
	$('#proforma-patient-search').addEventListener('input', renderProformaPatientPicker)
	$('#proforma-patient-criterion').addEventListener('change', renderProformaPatientPicker)
	$('#search-proforma-patients').addEventListener('click', renderProformaPatientPicker)
	$('#proforma-patient-picker').addEventListener('click', (event) => {
		const button = event.target.closest('[data-proforma-patient-id]')
		if (button) selectProformaPatient(button.dataset.proformaPatientId)
	})
	$('#next-proforma-stage').addEventListener('click', () => {
		if (state.proformaStage === 0) setProformaStage(1)
		else if (state.proformaStage === 1) setProformaStage(2)
		else saveProforma()
	})
	$('#back-proforma-stage').addEventListener('click', () => setProformaStage(1))
	$('#add-proforma-concept').addEventListener('click', () => {
		state.proformaConcepts.push({ concepto: '', cantidad: 1, monto_base: 0, precio: 0 })
		renderProformaConcepts()
	})
	$('#proforma-concept-list').addEventListener('input', (event) => {
		const input = event.target.closest('[data-proforma-field]')
		if (!input) return
		const concept = state.proformaConcepts[Number(input.closest('[data-index]').dataset.index)]
		concept[input.dataset.proformaField] = input.type === 'number' ? Number(input.value) : input.value
		updateProformaTotals()
	})
	$('#proforma-concept-list').addEventListener('change', (event) => {
		const input = event.target.closest('[data-proforma-field="concepto"]')
		if (input) applyCatalogPrice(state.proformaConcepts[Number(input.closest('[data-index]').dataset.index)], input, $('#proforma-currency').value)
	})
	$('#proforma-concept-list').addEventListener('click', (event) => {
		const button = event.target.closest('[data-remove-proforma-concept]')
		if (!button) return
		state.proformaConcepts.splice(Number(button.dataset.removeProformaConcept), 1)
		renderProformaConcepts()
		updateProformaTotals()
	})
	;['proforma-discount-base', 'proforma-igv', 'proforma-discount-total'].forEach((id) => $(`#${id}`).addEventListener('input', updateProformaTotals))
	$('#proforma-search').addEventListener('input', applyProformaFilters)
	$('#proforma-search-field').addEventListener('change', applyProformaFilters)
	$('#proforma-apply-filter').addEventListener('click', () => {
		state.proformaFilters = { from: $('#proforma-date-from').value, to: $('#proforma-date-to').value }
		loadProformas()
	})
	$('#proforma-clear-dates').addEventListener('click', () => {
		$('#proforma-date-from').value = ''
		$('#proforma-date-to').value = ''
		state.proformaFilters = { from: '', to: '' }
		loadProformas()
	})
	$('#proforma-list').addEventListener('click', (event) => {
		const detail = event.target.closest('[data-proforma-detail]')
		const convert = event.target.closest('[data-convert-proforma]')
		const approve = event.target.closest('[data-proforma-approve]')
		if (detail) openProformaDetail(detail.dataset.proformaDetail)
		else if (convert) convertProforma(convert.dataset.convertProforma)
		else if (approve) updateProformaStatus(approve.dataset.proformaApprove, 'aprobada')
	})
	$('#proforma-detail-card').addEventListener('click', (event) => {
		if (event.target.closest('[data-detail-convert]')) convertProforma(state.selectedProforma?.id)
		if (event.target.closest('[data-detail-approve]') && state.selectedProforma) {
			const proformaId = state.selectedProforma.id
			updateProformaStatus(proformaId, 'aprobada').then(() => {
				state.selectedProforma = state.proformas.find((item) => item.id === proformaId)
				if (state.selectedProforma) renderProformaDetail(state.selectedProforma)
			})
		}
	})
	$('#back-to-proformas').addEventListener('click', () => activateTab('proformas'))
}

async function saveProforma() {
	const details = state.proformaConcepts.filter((item) => item.concepto.trim()).map((item) => ({
		concepto: item.concepto.trim(),
		cantidad: Number(item.cantidad),
		monto_base: Number(item.monto_base || 0),
		precio: Number(item.precio || 0),
	}))
	const descuentos = [Number($('#proforma-discount-base').value), Number($('#proforma-discount-total').value)]
	const igv = Number($('#proforma-igv').value)
	if (!state.proformaPatient || !details.length || details.some((item) => !Number.isFinite(item.cantidad) || item.cantidad <= 0 || !Number.isFinite(item.precio) || item.precio < 0 || !Number.isFinite(item.monto_base) || item.monto_base < 0) || descuentos.some((value) => !Number.isFinite(value) || value < 0) || !Number.isFinite(igv) || igv < 0) {
		showToast('Selecciona un paciente y completa al menos un concepto con valores válidos')
		return
	}
	if (!Number.isInteger(Number($('#proforma-validity').value)) || Number($('#proforma-validity').value) < 1 || !$('#proforma-date').value) {
		showToast('Completa una fecha y una validez mayor a cero')
		setProformaStage(1)
		return
	}
	const user = await requireAuthenticatedUser('../ingresar.html')
	if (!user) return
	const button = $('#next-proforma-stage')
	button.disabled = true
	const subtotal = proformaSubtotal()
	const descuentoBase = Number($('#proforma-discount-base').value || 0)
	const tax = Number($('#proforma-igv').value || 0)
	const descuentoTotal = Number($('#proforma-discount-total').value || 0)
	const payload = {
		paciente_id: state.proformaPatient.id,
		medico_id: $('#proforma-doctor').value || null,
		registrado_por: user.id,
		fecha: $('#proforma-date').value,
		validez_dias: Number($('#proforma-validity').value),
		moneda: $('#proforma-currency').value,
		subtotal,
		igv: tax,
		descuento_base: descuentoBase,
		descuento_total: descuentoTotal,
		importe_total: Math.max(0, subtotal - descuentoBase + igv - descuentoTotal),
		estado: 'pendiente',
	}
	try {
		const { data: proforma, error } = await supabase.from('proformas').insert(payload).select().single()
		if (error) throw error
		const { error: detailsError } = await supabase.from('proforma_detalles').insert(details.map((item) => ({ ...item, proforma_id: proforma.id })))
		if (detailsError) {
			const { error: cleanupError } = await supabase.from('proformas').delete().eq('id', proforma.id).eq('registrado_por', user.id)
			if (cleanupError) throw new Error(`No se guardaron los conceptos (${detailsError.message}) y no se pudo limpiar la proforma incompleta (${cleanupError.message})`)
			throw detailsError
		}
		closeProformaDrawer()
		showToast('Proforma guardada correctamente')
		await loadProformas()
	} catch (error) {
		console.error('Error al guardar la proforma:', error)
		showToast(`No se pudo guardar la proforma: ${error.message}`)
	} finally {
		button.disabled = false
	}
}

async function updateProformaStatus(id, status) {
	const user = await requireAuthenticatedUser('../ingresar.html')
	if (!user) return
	const { error } = await supabase.from('proformas').update({ estado: status }).eq('id', id).eq('registrado_por', user.id)
	if (error) { showToast(`No se pudo actualizar la proforma: ${error.message}`); return }
	await loadProformas()
}

function renderProformaDetail(proforma) {
	const status = proformaStatus(proforma)
	const details = proforma.details.map((detail) => `<div class="detail-table"><span>${escapeHtml(detail.concepto)}</span><span>${Number(detail.cantidad)}</span><span>${money(detail.monto_base, proforma.moneda)}</span><span>${money(detail.precio, proforma.moneda)}</span></div>`).join('')
	$('#proforma-detail-number').textContent = `Proforma #${proforma.id}`
	$('#proforma-detail-card').innerHTML = `<section class="detail-section"><header><h2>Conceptos</h2><span class="proforma-status ${escapeHtml(status)}">${escapeHtml(status)}</span></header><div class="detail-table detail-table-head"><span>Concepto</span><span>Cantidad</span><span>Monto base</span><span>Precio unitario</span></div>${details || '<p class="detail-empty">No hay conceptos registrados.</p>'}<div class="detail-totals"><span>Subtotal <b>${money(proforma.subtotal, proforma.moneda)}</b></span><span>Descuento base <b>${money(proforma.descuento_base, proforma.moneda)}</b></span><span>IGV <b>${money(proforma.igv, proforma.moneda)}</b></span><span>Descuento adicional <b>${money(proforma.descuento_total, proforma.moneda)}</b></span><strong>Total cotizado <b>${money(proforma.importe_total, proforma.moneda)}</b></strong></div></section><div class="proforma-detail-actions">${status === 'pendiente' ? '<button type="button" data-detail-approve> Aprobar </button>' : ''}<button class="convert-proforma" type="button" data-detail-convert ${status === 'pendiente' || status === 'aprobada' ? '' : 'disabled'}>${status === 'convertida' ? 'Convertida' : 'Convertir a Comprobante'}</button></div>`
	$('#proforma-info-sidebar').innerHTML = `<div class="info-block"><h2>Información</h2><p>♙ <strong>${escapeHtml(proforma.paciente?.nombre_completo || 'Paciente')}</strong></p><p>♙ ${escapeHtml(proforma.medico?.full_name || 'Sin asignar')}</p><p>▣ ${dateDisplay(proforma.fecha)}</p><p>Válida por ${Number(proforma.validez_dias)} días</p><p>◉ ${proforma.moneda === 'USD' ? 'Dólares' : 'Soles'}</p><strong>${money(proforma.importe_total, proforma.moneda)}</strong></div>`
}

function openProformaDetail(id) {
	const proforma = state.proformas.find((item) => String(item.id) === String(id))
	if (!proforma) return
	state.selectedProforma = proforma
	updateFinanceControls('proformas')
	all('.finance-tab').forEach((tab) => {
		const active = tab.dataset.tab === 'proformas'
		tab.classList.toggle('is-active', active)
		tab.setAttribute('aria-selected', String(active))
	})
	hideFinanceViews()
	$('#proforma-detail-view').hidden = false
	renderProformaDetail(proforma)
	window.history.replaceState({}, '', `finanzas.html?proforma=${encodeURIComponent(id)}`)
}

async function convertProforma(id) {
	const proforma = state.proformas.find((item) => String(item.id) === String(id))
	if (!proforma) { showToast('No se encontró la proforma'); return }
	const status = proformaStatus(proforma)
	if (status === 'convertida') { showToast('Esta proforma ya fue convertida'); return }
	if (status !== 'pendiente' && status !== 'aprobada') { showToast('Solo se pueden convertir proformas pendientes o aprobadas'); return }
	if (!window.confirm('¿Convertir esta proforma en un comprobante de pago?')) return
	const buttons = $$('[data-convert-proforma], [data-detail-convert]').filter((button) => button.dataset.convertProforma === String(id) || button.hasAttribute('data-detail-convert'))
	buttons.forEach((button) => { button.disabled = true })
	try {
		const user = await requireAuthenticatedUser('../ingresar.html')
		if (!user) return
		let { data: receipt, error } = await supabase.from('comprobantes').select('id').eq('proforma_id', proforma.id).eq('registrado_por', user.id).maybeSingle()
		if (error) throw error
		if (!receipt) {
			const receiptPayload = {
				paciente_id: proforma.paciente_id,
				doctor_id: proforma.medico_id || null,
				motivo: `Proforma ${proforma.id}`,
				fecha: proforma.fecha,
				moneda: proforma.moneda,
				descuento_base: Number(proforma.descuento_base || 0),
				subtotal: Number(proforma.subtotal || 0),
				igv: Number(proforma.igv || 0),
				descuento_total: Number(proforma.descuento_total || 0),
				importe_total: Number(proforma.importe_total || 0),
				total_cancelado: 0,
				pendiente: Number(proforma.importe_total || 0),
				estado: 'activo',
				registrado_por: user.id,
				proforma_id: proforma.id,
			}
			const inserted = await supabase.from('comprobantes').insert(receiptPayload).select('id').single()
			if (inserted.error?.code === '23505') {
				const existing = await supabase.from('comprobantes').select('id').eq('proforma_id', proforma.id).eq('registrado_por', user.id).single()
				if (existing.error) throw existing.error
				receipt = existing.data
			} else {
				if (inserted.error) throw inserted.error
				receipt = inserted.data
			}
		}
		const { data: existingDetails, error: existingDetailsError } = await supabase.from('comprobante_detalles').select('id').eq('comprobante_id', receipt.id)
		if (existingDetailsError) throw existingDetailsError
		if (!existingDetails?.length && proforma.details.length) {
			const { error: detailError } = await supabase.from('comprobante_detalles').insert(proforma.details.map((detail) => ({
				comprobante_id: receipt.id,
				concepto: detail.concepto,
				cantidad: Number(detail.cantidad),
				monto_base: Number(detail.monto_base || 0),
				precio: Number(detail.precio || 0),
			})))
			if (detailError) throw detailError
		}
		const { error: updateError } = await supabase.from('proformas').update({ estado: 'convertida', comprobante_id: receipt.id }).eq('id', proforma.id).eq('registrado_por', user.id)
		if (updateError) throw updateError
		showToast('Proforma convertida a Comprobante de pago exitosamente')
		await Promise.all([loadProformas(), loadReceipts()])
		if (state.selectedProforma?.id === proforma.id) {
			state.selectedProforma = state.proformas.find((item) => item.id === proforma.id)
			if (state.selectedProforma) renderProformaDetail(state.selectedProforma)
		}
	} catch (error) {
		console.error('Error al convertir la proforma:', error)
		showToast(`No se pudo convertir la proforma: ${error.message}`)
	} finally {
		buttons.forEach((button) => { button.disabled = false })
	}
}
function applyReceiptFilters() { const search = ($('#receipt-search')?.value || '').trim().toLowerCase(); const field = $('#receipt-search-field')?.value || 'patient'; state.filteredReceipts = state.receipts.filter((receipt) => { if (!search) return true; const value = field === 'patient' ? receipt.paciente?.nombre_completo : field === 'motivo' ? receipt.motivo : receipt.id; return String(value || '').toLowerCase().includes(search) }); state.page = Math.min(state.page, Math.max(1, Math.ceil(state.filteredReceipts.length / state.pageSize))); renderReceipts(); renderKpis() }
function receiptStatus(receipt) { return Number(receipt.pendiente || 0) > 0 ? 'Pendiente' : 'Pagado' }
function renderKpis() { const totals = state.receipts.reduce((result, receipt) => { const currency = receipt.moneda === 'USD' ? 'USD' : 'PEN'; result[`${currency}Received`] += Number(receipt.total_cancelado || 0); result[`${currency}Pending`] += Number(receipt.pendiente || 0); return result }, { PENReceived: 0, PENPending: 0, USDReceived: 0, USDPending: 0 }); $('#kpi-received-pen').textContent = money(totals.PENReceived, 'PEN'); $('#kpi-pending-pen').textContent = money(totals.PENPending, 'PEN'); $('#kpi-received-usd').textContent = money(totals.USDReceived, 'USD'); $('#kpi-pending-usd').textContent = money(totals.USDPending, 'USD') }
function conceptSummary(receipt) { return receipt.details?.map((detail) => `${detail.concepto} x${detail.cantidad}`).join(', ') || receipt.motivo || '-' }
function renderReceipts() { const totalPages = Math.max(1, Math.ceil(state.filteredReceipts.length / state.pageSize)); const start = (state.page - 1) * state.pageSize; const visible = state.filteredReceipts.slice(start, start + state.pageSize); $('#receipt-count').textContent = `${state.filteredReceipts.length} ${state.filteredReceipts.length === 1 ? 'registro' : 'registros'}`; $('#pagination-info').textContent = state.filteredReceipts.length ? `Página ${state.page} de ${totalPages}` : '0 registros'; $('#page-select').innerHTML = Array.from({ length: totalPages }, (_, index) => `<option value="${index + 1}" ${index + 1 === state.page ? 'selected' : ''}>${index + 1}</option>`).join(''); $('#previous-page').disabled = state.page <= 1; $('#next-page').disabled = state.page >= totalPages; $('#receipt-list').innerHTML = visible.length ? visible.map((receipt) => `<button class="receipt-table receipt-table-row" data-receipt-id="${escapeHtml(receipt.id)}" type="button"><span><strong>${escapeHtml(receipt.paciente?.nombre_completo || 'Paciente sin nombre')}</strong><small>${escapeHtml(receipt.motivo || '-')}</small></span><span>${dateDisplay(receipt.fecha)}</span><span>${escapeHtml(conceptSummary(receipt))}</span><span>${escapeHtml(receipt.doctor?.full_name || 'Sin asignar')}</span><span>${escapeHtml(receipt.registrador?.full_name || receipt.registrado_por || '-')}</span><span>${receipt.moneda === 'USD' ? 'Dólares' : 'Soles'}</span><span>${money(receipt.total_cancelado, receipt.moneda)}</span><span><em class="receipt-status ${receiptStatus(receipt).toLowerCase()}">${receiptStatus(receipt)}</em></span><span>${escapeHtml(receipt.numero_comprobante || receipt.nro_comprobante || '-')}</span><span>${escapeHtml(receipt.estado_sunat || '-')}</span></button>`).join('') : '<div class="finance-empty"><span>▱</span><strong>No se encontraron registros</strong><small>Puedes empezar creando uno</small></div>' }
function sortByPaid() { state.sortAscending = !state.sortAscending; state.filteredReceipts.sort((first, second) => (Number(first.total_cancelado || 0) - Number(second.total_cancelado || 0)) * (state.sortAscending ? 1 : -1)); state.page = 1; renderReceipts() }

function renderPatientPicker() { const term = ($('#finance-patient-search')?.value || '').trim().toLowerCase(); const criterion = $('#patient-criterion')?.value || 'nombre_completo'; const filtered = state.patients.filter((patient) => String(patient[criterion] || '').toLowerCase().includes(term)).sort((a, b) => String(a.nombre_completo || '').localeCompare(String(b.nombre_completo || ''), 'es')); $('#finance-patient-picker').innerHTML = filtered.length ? filtered.map((patient) => `<button class="patient-option" data-patient-id="${escapeHtml(patient.id)}" type="button"><span class="patient-avatar">${initials(patient.nombre_completo)}</span><span><strong>${escapeHtml(patient.nombre_completo || 'Sin nombre')}</strong><small>${escapeHtml(patient.genero || 'Sexo no registrado')}, ${escapeHtml(calculateAge(patient.fecha_nacimiento))} · DNI ${escapeHtml(patient.documento_identidad || 'N/D')}</small></span></button>`).join('') : '<div class="finance-empty"><strong>No encontramos pacientes</strong><small>Prueba con otro nombre o documento.</small></div>' }
function updateStepButtons() { const labels = { 1: 'Datos', 2: 'Conceptos', 3: 'Pagos' }; $$('[data-drawer-step]').forEach((button) => { const step = Number(button.dataset.drawerStep); button.textContent = labels[step]; button.classList.toggle('is-current', step === state.stage) }) }
function setStage(stage) { if (stage > 0 && !state.selectedPatient) { showToast('Selecciona un paciente para continuar'); return } state.stage = stage; ['patient-stage', 'data-stage', 'concepts-stage', 'payments-stage'].forEach((id, index) => { $(`#${id}`).hidden = index !== stage }); $('#drawer-title').textContent = ['Selecciona un paciente', 'Datos', 'Conceptos', 'Pagos'][stage]; $('#back-stage').hidden = stage < 2; $('#next-stage').textContent = stage === 0 ? 'Datos →' : stage === 1 ? 'Conceptos →' : stage === 2 ? 'Pagos →' : 'Terminar'; updateStepButtons() }
function resetEditor() { state.selectedReceipt = null; state.selectedPatient = null; state.editing = false; state.concepts = [{ concepto: '', cantidad: 1, monto_base: 0, precio: 0 }]; state.payments = []; $('#drawer-mode').textContent = 'NUEVO COMPROBANTE'; $('#edit-danger-zone').hidden = true; $('#receipt-date').value = today(); $('#receipt-reason').value = ''; $('#receipt-currency').value = 'PEN'; $('#discount-base').value = 0; $('#tax-value').value = 0; $('#discount-total').value = 0; setStage(0); renderPatientPicker(); renderConcepts(); renderPayments(); updateTotals() }
function openNewDrawer() { resetEditor(); $('#receipt-drawer').hidden = false }
function openEditDrawer() { const receipt = state.selectedReceipt; if (!receipt) return; state.editing = true; state.selectedPatient = receipt.paciente; state.concepts = receipt.details.map((detail) => ({ concepto: detail.concepto, cantidad: detail.cantidad, monto_base: detail.monto_base, precio: detail.precio })); state.payments = receipt.payments.map((payment) => ({ monto: payment.monto, fecha: payment.fecha, metodo_pago: payment.metodo_pago })); $('#drawer-mode').textContent = 'EDICIÓN'; $('#selected-patient-heading').innerHTML = `${escapeHtml(receipt.paciente?.nombre_completo || 'Paciente')}<small>${escapeHtml(receipt.fecha || today())} <em class="edit-badge">Edición</em></small>`; $('#receipt-doctor').value = receipt.doctor_id || ''; $('#receipt-reason').value = receipt.motivo || ''; $('#receipt-date').value = String(receipt.fecha || today()).slice(0, 10); $('#receipt-currency').value = receipt.moneda || 'PEN'; $('#discount-base').value = receipt.descuento_base || 0; $('#tax-value').value = receipt.igv || 0; $('#discount-total').value = receipt.descuento_total || 0; $('#edit-danger-zone').hidden = false; renderConcepts(); renderPayments(); updateTotals(); setStage(1); $('#receipt-drawer').hidden = false }
function closeDrawer() { $('#receipt-drawer').hidden = true }
function selectPatient(id) { state.selectedPatient = state.patients.find((patient) => String(patient.id) === String(id)); if (!state.selectedPatient) return; $('#selected-patient-heading').innerHTML = `${escapeHtml(state.selectedPatient.nombre_completo)}<small>${escapeHtml(state.selectedPatient.documento_identidad || 'DNI no registrado')} · ${escapeHtml(calculateAge(state.selectedPatient.fecha_nacimiento))}</small>`; setStage(1) }
function renderConcepts() { $('#concept-list').innerHTML = `<div class="concepts-head"><span>Concepto</span><span>Cantidad</span><span>Monto base</span><span>Precio</span><span></span></div>${state.concepts.map((concept, index) => `<div class="concept-row" data-index="${index}"><input data-field="concepto" list="service-catalog-options" value="${escapeHtml(concept.concepto)}" placeholder="Servicio"><input data-field="cantidad" type="number" min="1" step="1" value="${concept.cantidad}"><input data-field="monto_base" type="number" min="0" step="0.01" value="${concept.monto_base}"><input data-field="precio" type="number" min="0" step="0.01" value="${concept.precio}"><button class="delete-row" data-remove-concept="${index}" type="button" aria-label="Eliminar concepto">⌫</button></div>`).join('')}` }
function renderPayments() { $('#payment-list').innerHTML = `<div class="payment-head"><span>Monto</span><span>Fecha</span><span>Método de pago</span><span></span></div>${state.payments.map((payment, index) => `<div class="payment-row" data-index="${index}"><input data-payment-field="monto" type="number" min="0" step="0.01" value="${payment.monto || ''}" placeholder="Monto"><input data-payment-field="fecha" type="date" value="${payment.fecha || today()}"><select data-payment-field="metodo_pago"><option ${payment.metodo_pago === 'Efectivo' ? 'selected' : ''}>Efectivo</option><option ${payment.metodo_pago === 'Tarjeta' ? 'selected' : ''}>Tarjeta</option><option ${payment.metodo_pago === 'Yape/Plin' ? 'selected' : ''}>Yape/Plin</option><option ${payment.metodo_pago === 'Transferencia' ? 'selected' : ''}>Transferencia</select><button class="delete-row" data-remove-payment="${index}" type="button" aria-label="Eliminar pago">⌫</button></div>`).join('')}`; updateTotals() }
function updateTotals() { const subtotal = state.concepts.reduce((sum, concept) => sum + Number(concept.cantidad || 0) * Number(concept.precio || 0), 0); const total = Math.max(0, subtotal - Number($('#discount-base').value || 0) + Number($('#tax-value').value || 0) - Number($('#discount-total').value || 0)); const paid = state.payments.reduce((sum, payment) => sum + Number(payment.monto || 0), 0); $('#subtotal-value').textContent = subtotal.toFixed(2); $('#total-value').textContent = total.toFixed(2); $('#paid-value').textContent = paid.toFixed(2); $('#balance-value').textContent = Math.max(0, total - paid).toFixed(2) }

async function saveReceipt() {
	try {
		const user = await requireAuthenticatedUser('../ingresar.html')
		if (!user) return
		const subtotal = Number($('#subtotal-value').textContent)
		const importeTotal = Number($('#total-value').textContent)
		const totalCancelado = state.payments.reduce((sum, payment) => sum + Number(payment.monto || 0), 0)
		const payload = { paciente_id: state.selectedPatient.id, doctor_id: $('#receipt-doctor').value || null, motivo: $('#receipt-reason').value.trim() || null, fecha: $('#receipt-date').value || today(), moneda: $('#receipt-currency').value, descuento_base: Number($('#discount-base').value || 0), subtotal, igv: Number($('#tax-value').value || 0), descuento_total: Number($('#discount-total').value || 0), importe_total: importeTotal, total_cancelado: totalCancelado, pendiente: Math.max(0, importeTotal - totalCancelado), estado: 'activo' }
		let receipt = state.selectedReceipt
		if (state.editing) {
			const { error } = await supabase.from('comprobantes').update(payload).eq('id', receipt.id).eq('registrado_por', user.id)
			if (error) throw error
			await supabase.from('comprobante_detalles').delete().eq('comprobante_id', receipt.id)
			await supabase.from('comprobante_pagos').delete().eq('comprobante_id', receipt.id)
		} else {
			const { data, error } = await supabase.from('comprobantes').insert({ ...payload, registrado_por: user.id }).select().single()
			if (error) throw error
			receipt = data
		}
		const details = state.concepts.filter((concept) => concept.concepto || Number(concept.precio)).map((concept) => ({ comprobante_id: receipt.id, concepto: concept.concepto || 'Servicio', cantidad: Number(concept.cantidad || 1), monto_base: Number(concept.monto_base || 0), precio: Number(concept.precio || 0) }))
		if (details.length) {
			const { error } = await supabase.from('comprobante_detalles').insert(details)
			if (error) throw error
		}
		const payments = state.payments.filter((payment) => Number(payment.monto) > 0).map((payment) => ({ comprobante_id: receipt.id, monto: Number(payment.monto), fecha: payment.fecha || today(), metodo_pago: payment.metodo_pago }))
		if (payments.length) {
			const { error } = await supabase.from('comprobante_pagos').insert(payments)
			if (error) throw error
		}
		showToast(state.editing ? 'Comprobante actualizado' : 'Comprobante guardado')
		closeDrawer()
		await loadReceipts()
		receipt = state.receipts.find((item) => String(item.id) === String(receipt.id)) || (await loadSingleReceipt(receipt.id))
		if (receipt) printReceipt(receipt)
		if (state.editing && receipt) await openDetail(receipt.id)
	} catch (error) {
		console.error(error)
		showToast(`No se pudo guardar: ${error.message}`)
	}
}
async function deleteReceipt() {
	if (!state.selectedReceipt) return
	try {
		const user = await requireAuthenticatedUser('../ingresar.html')
		if (!user) return
		const { error } = await supabase.from('comprobantes').update({ estado: 'eliminado' }).eq('id', state.selectedReceipt.id).eq('registrado_por', user.id)
		if (error) throw error
		closeDrawer()
		window.history.back()
		showToast('Comprobante eliminado')
		await loadReceipts()
	} catch (error) {
		showToast(`No se pudo eliminar: ${error.message}`)
	}
}

function renderDetail(receipt) { const status = receiptStatus(receipt); $('#detail-receipt-number').textContent = `Comprobante #${receipt.id}`; $('#receipt-detail-card').innerHTML = `<section class="detail-section"><header><h2>Recibo</h2><span class="receipt-status ${status.toLowerCase()}">${status}</span></header><div class="detail-table detail-table-head"><span>Concepto</span><span>Cantidad</span><span>Monto base</span><span>Precio</span></div>${receipt.details.length ? receipt.details.map((detail) => `<div class="detail-table"><span>${escapeHtml(detail.concepto)}</span><span>${detail.cantidad}</span><span>${money(detail.monto_base, receipt.moneda)}</span><span>${money(detail.precio, receipt.moneda)}</span></div>`).join('') : '<p class="detail-empty">No hay conceptos registrados.</p>'}<div class="detail-totals"><span>Descuento base <b>${money(receipt.descuento_base, receipt.moneda)}</b></span><span>Subtotal <b>${money(receipt.subtotal, receipt.moneda)}</b></span><span>IGV <b>${money(receipt.igv, receipt.moneda)}</b></span><span>Descuento total <b>${money(receipt.descuento_total, receipt.moneda)}</b></span><strong>Importe total <b>${money(receipt.importe_total, receipt.moneda)}</b></strong></div></section><section class="detail-section"><header><h2>Pagos</h2></header><div class="detail-table detail-table-head"><span>Método</span><span>Fecha</span><span>Monto</span><span></span></div>${receipt.payments.length ? receipt.payments.map((payment) => `<div class="detail-table"><span>${escapeHtml(payment.metodo_pago)}</span><span>${dateDisplay(payment.fecha)}</span><span>${money(payment.monto, receipt.moneda)}</span><span></span></div>`).join('') : '<p class="detail-empty">No hay pagos registrados.</p>'}<div class="payment-summary"><div><span>Pendiente</span><strong>${money(receipt.pendiente, receipt.moneda)}</strong></div><div><span>Pagado</span><strong>${money(receipt.total_cancelado, receipt.moneda)}</strong></div></div></section><section class="detail-section"><h2>Observaciones</h2><p>${escapeHtml(receipt.motivo || 'Sin observaciones.')}</p></section><section class="detail-section"><header><h2>Documentos</h2><span class="record-badge">1 registro</span></header><div class="document-row"><span>Nota de venta</span><button class="link-button" id="download-detail-pdf" type="button">PDF</button></div></section>`; $('#receipt-info-sidebar').innerHTML = `<div class="info-block"><h2>Información</h2><p>♙ <strong>${escapeHtml(receipt.paciente?.nombre_completo || 'Paciente')}</strong></p><p>♙ ${escapeHtml(receipt.doctor?.full_name || 'Sin atendido por')}</p><p>▣ ${dateDisplay(receipt.fecha)}</p><p>◉ ${receipt.moneda === 'USD' ? 'Dólares' : 'Soles'}</p><span class="receipt-status ${status.toLowerCase()}">${status}</span></div><button class="download-receipt" id="download-sidebar-pdf" type="button">Descargar recibo →</button><div class="activity-block"><h2>Actividad</h2><p><strong>${escapeHtml(receipt.registrador?.full_name || receipt.registrado_por || 'Usuario')}</strong> creó el recibo.<small>${dateDisplay(receipt.created_at || receipt.fecha)}</small></p></div>`; $('#download-detail-pdf').addEventListener('click', () => printReceipt(receipt)); $('#download-sidebar-pdf').addEventListener('click', () => printReceipt(receipt)) }
async function openDetail(id) { const receipt = state.receipts.find((item) => String(item.id) === String(id)) || (await loadSingleReceipt(id)); if (!receipt) return; state.selectedReceipt = receipt; hideFinanceViews(); $('#receipt-detail-view').hidden = false; renderDetail(receipt); window.history.replaceState({}, '', `finanzas.html?id=${encodeURIComponent(id)}`) }
async function loadSingleReceipt(id) {
	const user = await requireAuthenticatedUser('../ingresar.html')
	if (!user) return null
	const { data, error } = await supabase.from('comprobantes').select('*, paciente:pacientes(nombre_completo, documento_identidad, genero, fecha_nacimiento), doctor:profiles(full_name)').eq('id', id).eq('registrado_por', user.id).single()
	if (error) { showToast('No se encontró el comprobante'); return null }
	const [{ data: details }, { data: payments }] = await Promise.all([supabase.from('comprobante_detalles').select('*').eq('comprobante_id', id), supabase.from('comprobante_pagos').select('*').eq('comprobante_id', id)])
	return { ...data, details: details || [], payments: payments || [] }
}
function printReceipt(receipt) { const JsPdf = window.jspdf?.jsPDF; if (!JsPdf) { showToast('No se pudo cargar el generador PDF'); return } const doc = new JsPdf(); const currency = receipt.moneda; let y = 18; const line = (text, x = 16, size = 9) => { doc.setFontSize(size); doc.text(String(text), x, y); y += 6 }; doc.setFontSize(20); doc.text('Nota de venta', 16, y); doc.setFontSize(13); doc.text('Consultorio Médico', 145, y); y += 8; line(`# ${String(receipt.id).slice(0, 16)}`); line(`Fecha de emisión : ${String(receipt.fecha || '').slice(0, 10)}`); doc.setFontSize(8); doc.text('Este documento no está validado ante SUNAT.', 16, y); y += 12; line(`Paciente: ${receipt.paciente?.nombre_completo || '-'}`, 16, 10); line(`DNI: ${receipt.paciente?.documento_identidad || '-'}`); line(`Edad: ${calculateAge(receipt.paciente?.fecha_nacimiento)}`); y += 4; line('Cuenta', 16, 12); doc.setFontSize(8); doc.text('#', 16, y); doc.text('Concepto', 27, y); doc.text('Precio Unit.', 105, y); doc.text('Cant.', 133, y); doc.text('Monto base', 149, y); doc.text('Precio', 179, y); y += 5; receipt.details.forEach((detail, index) => { doc.text(String(index + 1), 16, y); doc.text(String(detail.concepto || 'Servicio').slice(0, 34), 27, y); doc.text(money(detail.precio, currency), 105, y); doc.text(String(detail.cantidad), 133, y); doc.text(money(detail.monto_base, currency), 149, y); doc.text(money(Number(detail.cantidad || 0) * Number(detail.precio || 0), currency), 179, y); y += 6 }); y += 3; ['Descuento base', 'Subtotal', 'IGV', 'Descuento total', 'Total'].forEach((label) => { const value = label === 'Descuento base' ? receipt.descuento_base : label === 'Subtotal' ? receipt.subtotal : label === 'IGV' ? receipt.igv : label === 'Descuento total' ? receipt.descuento_total : receipt.importe_total; doc.text(`${label}: ${money(value, currency)}`, 125, y); y += 6 }); y += 5; line('Pagos', 16, 12); doc.setFontSize(8); doc.text('Método de pago', 16, y); doc.text('Fecha', 100, y); doc.text('Monto', 150, y); y += 5; receipt.payments.forEach((payment) => { doc.text(String(payment.metodo_pago || '-'), 16, y); doc.text(String(payment.fecha || '-'), 100, y); doc.text(money(payment.monto, currency), 150, y); y += 6 }); y += 4; doc.text(`Pagado: ${money(receipt.total_cancelado, currency)}`, 125, y); y += 6; doc.text(`Pendiente: ${money(receipt.pendiente, currency)}`, 125, y); doc.save(`Nota_de_venta_${String(receipt.id).slice(0, 8)}.pdf`) }

function exportReceipts() { const headers = ['FECHA DE ATENCIÓN', 'FECHA DE REGISTRO', 'REGISTRADO POR', 'NOMBRES', 'APELLIDOS', 'TIPO DE DOCUMENTO', '# DE DOCUMENTO', 'EMPRESA', 'RUC', 'MOTIVO DE ATENCIÓN', 'MONEDA', 'DESCUENTO BASE', 'DESCUENTO TOTAL', 'CONCEPTOS SIN IGV', 'CONCEPTOS CON IGV', 'TOTAL A PAGAR SOLES', 'TOTAL A PAGAR DOLARES', 'PAGADO SOLES', 'PAGADO DÓLARES', 'PENDIENTE SOLES', 'PENDIENTE DÓLARES', 'CANTIDAD', 'CONCEPTOS', 'CATEGORÍAS', 'ATENDIDO POR', 'ESTADO', 'NRO DE COMPROBANTE INTERNO', 'TIPO DE COMPORBANTE', 'FECHA DE EMISIÓN', 'NRO. CPE', 'NRO.NC', 'DOC RELAC', 'ESTADO SUNAT']; const rows = state.filteredReceipts.map((receipt) => { const name = String(receipt.paciente?.nombre_completo || '').trim().split(/\s+/); const paid = Number(receipt.total_cancelado || 0); const pending = Number(receipt.pendiente || 0); const isUsd = receipt.moneda === 'USD'; return { 'FECHA DE ATENCIÓN': receipt.fecha || '', 'FECHA DE REGISTRO': receipt.created_at || '', 'REGISTRADO POR': receipt.registrador?.full_name || receipt.registrado_por || '', NOMBRES: name.slice(0, 2).join(' '), APELLIDOS: name.slice(2).join(' '), 'TIPO DE DOCUMENTO': 'DNI', '# DE DOCUMENTO': receipt.paciente?.documento_identidad || '', EMPRESA: receipt.empresa || '', RUC: receipt.ruc || '', 'MOTIVO DE ATENCIÓN': receipt.motivo || '', MONEDA: isUsd ? 'Dólares' : 'Soles', 'DESCUENTO BASE': receipt.descuento_base || 0, 'DESCUENTO TOTAL': receipt.descuento_total || 0, 'CONCEPTOS SIN IGV': receipt.subtotal || 0, 'CONCEPTOS CON IGV': Number(receipt.subtotal || 0) + Number(receipt.igv || 0), 'TOTAL A PAGAR SOLES': isUsd ? 0 : receipt.importe_total || 0, 'TOTAL A PAGAR DOLARES': isUsd ? receipt.importe_total || 0 : 0, 'PAGADO SOLES': isUsd ? 0 : paid, 'PAGADO DÓLARES': isUsd ? paid : 0, 'PENDIENTE SOLES': isUsd ? 0 : pending, 'PENDIENTE DÓLARES': isUsd ? pending : 0, CANTIDAD: receipt.details.reduce((sum, detail) => sum + Number(detail.cantidad || 0), 0), CONCEPTOS: receipt.details.map((detail) => detail.concepto).join(', '), 'CATEGORÍAS': receipt.categorias || '', 'ATENDIDO POR': receipt.doctor?.full_name || '', ESTADO: receiptStatus(receipt), 'NRO DE COMPROBANTE INTERNO': receipt.numero_comprobante || receipt.nro_comprobante || '', 'TIPO DE COMPORBANTE': receipt.tipo_comprobante || 'Nota de venta', 'FECHA DE EMISIÓN': receipt.fecha || '', 'NRO. CPE': receipt.nro_cpe || '', 'NRO.NC': receipt.nro_nc || '', 'DOC RELAC': receipt.doc_relac || '', 'ESTADO SUNAT': receipt.estado_sunat || '' } }); if (window.XLSX) { const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers }); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Comprobantes'); XLSX.writeFile(workbook, `Comprobantes_${today()}.xlsx`) } else showToast('No se pudo cargar el exportador Excel') }

function bindEvents() { $('#new-receipt').addEventListener('click', openNewDrawer); $('#close-drawer').addEventListener('click', closeDrawer); $('#cancel-receipt').addEventListener('click', closeDrawer); $('#sidebar-logout').addEventListener('click', async () => { const { error } = await supabase.auth.signOut(); if (error) { showToast(`No se pudo cerrar la sesión: ${error.message}`); return } state.receipts = []; state.filteredReceipts = []; state.patients = []; state.doctors = []; state.services = []; state.concepts = []; state.payments = []; state.selectedPatient = null; state.selectedReceipt = null; state.stage = 0; state.editing = false; state.showDeleted = false; state.page = 1; state.sortAscending = false; state.filters = { from: '', to: '' }; subState.incomes = []; subState.expenses = []; subState.expenseFiltered = []; subState.expenseSort = 'desc'; subState.incomeSort = 'desc'; subState.expenseEditing = null; document.body.replaceChildren(); clearClientStorage(); window.location.href = '../ingresar.html' }); $('#finance-patient-search').addEventListener('input', renderPatientPicker); $('#patient-criterion').addEventListener('change', renderPatientPicker); $('#search-patients').addEventListener('click', renderPatientPicker); $('#finance-patient-picker').addEventListener('click', (event) => { const option = event.target.closest('[data-patient-id]'); if (option) selectPatient(option.dataset.patientId) }); $('#next-stage').addEventListener('click', () => state.stage < 3 ? setStage(state.stage + 1) : saveReceipt()); $('#back-stage').addEventListener('click', () => setStage(state.stage - 1)); $$('[data-drawer-step]').forEach((button) => button.addEventListener('click', () => setStage(Number(button.dataset.drawerStep)))); $('#add-concept').addEventListener('click', () => { state.concepts.push({ concepto: '', cantidad: 1, monto_base: 0, precio: 0 }); renderConcepts() }); $('#concept-list').addEventListener('input', (event) => { const row = event.target.closest('.concept-row'); if (row) { state.concepts[Number(row.dataset.index)][event.target.dataset.field] = event.target.type === 'number' ? Number(event.target.value) : event.target.value; updateTotals() } }); $('#concept-list').addEventListener('change', (event) => { const input = event.target.closest('[data-field="concepto"]'); if (input) applyCatalogPrice(state.concepts[Number(input.closest('[data-index]').dataset.index)], input, $('#receipt-currency').value) }); $('#concept-list').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-concept]'); if (button) { state.concepts.splice(Number(button.dataset.removeConcept), 1); renderConcepts(); updateTotals() } }); ['discount-base', 'tax-value', 'discount-total'].forEach((id) => $(`#${id}`).addEventListener('input', updateTotals)); $('#add-payment').addEventListener('click', () => { state.payments.push({ monto: 0, fecha: today(), metodo_pago: 'Efectivo' }); renderPayments() }); $('#payment-list').addEventListener('input', (event) => { const row = event.target.closest('.payment-row'); if (row) { state.payments[Number(row.dataset.index)][event.target.dataset.paymentField] = event.target.value; updateTotals() } }); $('#payment-list').addEventListener('change', (event) => { const row = event.target.closest('.payment-row'); if (row) { state.payments[Number(row.dataset.index)][event.target.dataset.paymentField] = event.target.value; updateTotals() } }); $('#payment-list').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-payment]'); if (button) { state.payments.splice(Number(button.dataset.removePayment), 1); renderPayments() } }); $('#receipt-list').addEventListener('click', (event) => { const row = event.target.closest('[data-receipt-id]'); if (row) openDetail(row.dataset.receiptId) }); $('#receipt-search').addEventListener('input', applyReceiptFilters); $('#receipt-search-button').addEventListener('click', applyReceiptFilters); $('#sort-paid').addEventListener('click', sortByPaid); $('#page-select').addEventListener('change', (event) => { state.page = Number(event.target.value); renderReceipts() }); $('#previous-page').addEventListener('click', () => { if (state.page > 1) { state.page--; renderReceipts() } }); $('#next-page').addEventListener('click', () => { if (state.page < Math.ceil(state.filteredReceipts.length / state.pageSize)) { state.page++; renderReceipts() } }); $('#export-receipts').addEventListener('click', exportReceipts); $('#apply-filter').addEventListener('click', () => { state.filters.from = $('#date-from').value; state.filters.to = $('#date-to').value; loadReceipts() }); $('#clear-dates').addEventListener('click', () => { $('#date-from').value = ''; $('#date-to').value = ''; state.filters = { from: '', to: '' }; loadReceipts() }); $('#deleted-toggle').addEventListener('click', () => { state.showDeleted = !state.showDeleted; $('#deleted-toggle').textContent = state.showDeleted ? '← Regresar' : '▱ Ver eliminados'; $('#finance-page-title').textContent = state.showDeleted ? 'Comprobantes eliminados' : 'Finanzas'; $('#receipt-heading').firstChild.textContent = state.showDeleted ? 'Comprobantes eliminados ' : 'Comprobantes '; loadReceipts() }); $('#back-to-receipts').addEventListener('click', () => { window.history.pushState({}, '', 'finanzas.html'); $('#receipt-detail-view').hidden = true; $('#finance-list-view').hidden = false; loadReceipts() }); $('#edit-receipt').addEventListener('click', openEditDrawer); $('#delete-from-editor').addEventListener('click', deleteReceipt); $('#advanced-filter').addEventListener('click', () => showToast('Usa el rango de fechas para filtrar comprobantes')); }
async function init() { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; bindEvents(); const detailId = new URLSearchParams(window.location.search).get('id'); await Promise.all([loadPatients(), loadDoctors(), loadServiceCatalog().catch((error) => { console.error('No se pudo cargar el catálogo de servicios:', error); showToast(`No se pudo cargar el catálogo de servicios: ${error.message}`) })]); await loadReceipts(); if (detailId) await openDetail(detailId); else { resetEditor(); $('#receipt-drawer').hidden = true } }
init().catch((error) => { console.error('No se pudo iniciar Finanzas:', error); showToast('No se pudo iniciar el módulo de Finanzas') })

const subState = { incomes: [], expenses: [], expenseFiltered: [], expenseSort: 'desc', incomeSort: 'desc', expenseEditing: null }
const get = (selector) => document.querySelector(legacyViewSelectors[selector] || selector)
const all = (selector) => [...document.querySelectorAll(selector)]
const dateNow = () => new Date().toISOString().slice(0, 10)
const escapeValue = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
const amount = (value, currency) => `${currency === 'USD' || currency === 'Dólares' || currency === 'D�lares' ? '$' : 'S/.'} ${Number(value || 0).toFixed(2)}`
const displayDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE') : '-'
const toast = (message) => { const element = get('#toast'); if (!element) return; element.textContent = message; element.classList.add('is-visible'); window.setTimeout(() => element.classList.remove('is-visible'), 3000) }
const range = (prefix) => ({ from: get(`#${prefix}-date-from`).value, to: get(`#${prefix}-date-to`).value })

async function loadIncomeData() {
	try {
		const user = await requireAuthenticatedUser('../ingresar.html')
		if (!user) {
			subState.incomes = []
			renderIncome()
			return
		}
		subState.incomes = []
		renderIncome()
		let query = supabase.from('comprobante_pagos').select('*, comprobante:comprobantes!inner(*, paciente:pacientes(nombre_completo, documento_identidad), doctor:profiles(full_name))').eq('comprobante.registrado_por', user.id).order('fecha', { ascending: false })
		const dates = range('income'); if (dates.from) query = query.gte('fecha', dates.from); if (dates.to) query = query.lte('fecha', dates.to)
		const { data, error } = await query; if (error) throw error
		subState.incomes = data || []; renderIncome()
	} catch (error) { console.error('Error al cargar ingresos:', error); toast(`No se pudieron cargar los ingresos: ${error.message}`) }
}
function incomeTotals(currency) { return subState.incomes.filter((payment) => (payment.comprobante?.moneda || 'PEN') === currency).reduce((sum, payment) => sum + Number(payment.monto || 0), 0) }
function renderIncome() {
	const currency = get('#income-currency').value
	const filteredIncomes = subState.incomes.filter((payment) => (payment.comprobante?.moneda || 'PEN') === currency)
	const total = filteredIncomes.reduce((sum, payment) => sum + Number(payment.monto || 0), 0)
	const groups = new Map()
	filteredIncomes.forEach((payment) => {
		const label = String(payment.metodo_pago || '').trim() || 'Sin categoría'
		groups.set(label, (groups.get(label) || 0) + Number(payment.monto || 0))
	})
	const segments = [...groups].filter(([, value]) => value > 0)
	const colors = ['#08764f', '#2f8068', '#55a887', '#83c4a8', '#b2dfc9', '#397b67']
	const stops = []
	let currentAngle = 0
	segments.forEach(([, value], index) => {
		const nextAngle = currentAngle + value / total * 360
		stops.push(`${colors[index % colors.length]} ${currentAngle}deg ${nextAngle}deg`)
		currentAngle = nextAngle
	})
	const donut = get('#income-donut')
	donut.style.setProperty('--income-chart', total > 0 ? stops.join(', ') : '#dcefe6')
	donut.setAttribute('aria-label', `Ingresos en ${currency === 'USD' ? 'dólares' : 'soles'}: ${amount(total, currency)}`)
	get('#income-total').textContent = amount(total, currency)
	const legend = get('#income-legend')
	legend.replaceChildren()
	if (segments.length) {
		segments.forEach(([label, value], index) => {
			const row = document.createElement('div')
			row.className = 'income-legend-item'
			const name = document.createElement('span')
			name.className = 'income-legend-label'
			const dot = document.createElement('span')
			dot.className = 'income-legend-dot'
			dot.style.backgroundColor = colors[index % colors.length]
			const labelText = document.createElement('span')
			labelText.textContent = label
			name.append(dot, labelText)
			const subtotal = document.createElement('strong')
			subtotal.textContent = amount(value, currency)
			row.append(name, subtotal)
			legend.appendChild(row)
		})
	} else {
		const empty = document.createElement('div')
		empty.className = 'income-legend-item'
		const label = document.createElement('span')
		label.className = 'income-legend-label'
		label.textContent = 'Sin ingresos en este periodo'
		const subtotal = document.createElement('strong')
		subtotal.textContent = amount(0, currency)
		empty.append(label, subtotal)
		legend.appendChild(empty)
	}
	const cash = [{ name: 'Caja soles', value: incomeTotals('PEN'), currency: 'Soles' }, { name: 'Caja dolares', value: incomeTotals('USD'), currency: 'D�lares' }].sort((a, b) => (a.value - b.value) * (subState.incomeSort === 'asc' ? 1 : -1))
	get('#income-cash-list').innerHTML = cash.map((item) => `<div class="cash-row"><span>${item.name}</span><strong>${amount(item.value, item.currency)}</strong></div>`).join('')
	const visible = [...subState.incomes].sort((a, b) => (Number(a.monto || 0) - Number(b.monto || 0)) * (subState.incomeSort === 'asc' ? 1 : -1))
	get('#income-count').textContent = `${visible.length} ${visible.length === 1 ? 'registro' : 'registros'}`
	get('#income-list').innerHTML = visible.length ? `<div class="income-table income-table-head"><span>Fecha de pago</span><span>Paciente</span><span>Medio de pago</span><span>Moneda</span><span>Monto</span></div>${visible.map((payment) => `<div class="income-table"><span>${displayDate(payment.fecha)}</span><span>${escapeValue(payment.comprobante?.paciente?.nombre_completo || '-')}</span><span>${escapeValue(payment.metodo_pago || '-')}</span><span>${payment.comprobante?.moneda === 'USD' ? 'Dólares' : 'Soles'}</span><strong>${amount(payment.monto, payment.comprobante?.moneda)}</strong></div>`).join('')}` : '<div class="finance-empty"><span>▱</span><strong>No se encontraron registros</strong><small>Puedes empezar creando uno</small></div>'
}
function exportIncome() { const headers = ['FECHA DE ATENCIÓN', 'FECHA DE REGISTRO', 'FECHA DE PAGO', 'REGISTRADO POR', 'NOMBRES', 'APELLIDOS', 'TIPO DE DOCUMENTO', '# DE DOCUMENTO', 'EMPRESA', 'RUC', 'MEDIO DE PAGO', 'OPERACIÓN', 'MOTIVO DE ATENCIÓN', 'SOLES', 'DÓLARES', 'CANTIDAD', 'CONCEPTOS', 'CATEGORÍAS', 'ATENDIDO POR', 'NRO DE COMPROBANTE INTERNO', 'TIPO DE COMPROBANTE', 'FECHA DE EMISIÓN', 'NRO. CPE', 'NRO. NC', 'DOC RELAC']; const rows = subState.incomes.map((payment) => { const receipt = payment.comprobante || {}; const patientName = String(receipt.paciente?.nombre_completo || '').split(/\s+/); const usd = receipt.moneda === 'USD'; return { 'FECHA DE ATENCIÓN': receipt.fecha || '', 'FECHA DE REGISTRO': receipt.created_at || '', 'FECHA DE PAGO': payment.fecha || '', 'REGISTRADO POR': '', NOMBRES: patientName.slice(0, 2).join(' '), APELLIDOS: patientName.slice(2).join(' '), 'TIPO DE DOCUMENTO': 'DNI', '# DE DOCUMENTO': receipt.paciente?.documento_identidad || '', EMPRESA: '', RUC: '', 'MEDIO DE PAGO': payment.metodo_pago || '', OPERACIÓN: payment.id || '', 'MOTIVO DE ATENCIÓN': receipt.motivo || '', SOLES: usd ? 0 : payment.monto, 'DÓLARES': usd ? payment.monto : 0, CANTIDAD: receipt.details?.length || '', CONCEPTOS: '', 'CATEGORÍAS': '', 'ATENDIDO POR': receipt.doctor?.full_name || '', 'NRO DE COMPROBANTE INTERNO': receipt.numero_comprobante || '', 'TIPO DE COMPROBANTE': 'Nota de venta', 'FECHA DE EMISIÓN': receipt.fecha || '', 'NRO. CPE': receipt.nro_cpe || '', 'NRO. NC': receipt.nro_nc || '', 'DOC RELAC': receipt.doc_relac || '' } }); if (!window.XLSX) { toast('No se pudo cargar el exportador Excel'); return } const sheet = XLSX.utils.json_to_sheet(rows, { header: headers }); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Ingresos'); XLSX.writeFile(book, `Ingresos_${dateNow()}.xlsx`) }

async function loadExpenses() { try { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; let query = supabase.from('egresos').select('*').eq('registrado_por', user.id).order('fecha', { ascending: false }); const dates = range('expense'); if (dates.from) query = query.gte('fecha', dates.from); if (dates.to) query = query.lte('fecha', dates.to); const { data, error } = await query; if (error) throw error; subState.expenses = data || []; applyExpenseSearch() } catch (error) { console.error('Error al cargar egresos:', error); toast(`No se pudieron cargar los egresos: ${error.message}`) } }
function applyExpenseSearch() { const term = (get('#expense-search').value || '').trim().toLowerCase(); const field = get('#expense-search-field').value; subState.expenseFiltered = subState.expenses.filter((expense) => !term || String(expense[field] || '').toLowerCase().includes(term)); renderExpenses() }
function exportExpenses() { const headers = ['Concepto', 'Fecha', 'Categoría', 'Medio de pago', 'Registrado por', 'Moneda', 'Monto']; const rows = subState.expenseFiltered.map((expense) => ({ Concepto: expense.concepto || '', Fecha: expense.fecha || '', 'Categoría': expense.categoria || 'Sin categoría', 'Medio de pago': expense.medio_pago || '', 'Registrado por': expense.registrado_por_nombre || '', Moneda: expense.moneda === 'USD' || expense.moneda === 'Dólares' || expense.moneda === 'D�lares' ? 'Dólares' : 'Soles', Monto: Number(expense.monto || 0) })); if (!window.XLSX) { toast('No se pudo cargar el exportador Excel'); return } const sheet = XLSX.utils.json_to_sheet(rows, { header: headers }); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Egresos'); XLSX.writeFile(book, `Egresos_${dateNow()}.xlsx`) }
function renderExpenses() {
	const expenses = [...subState.expenseFiltered].sort((a, b) => (Number(a.monto || 0) - Number(b.monto || 0)) * (subState.expenseSort === 'asc' ? 1 : -1))
	const selectedCurrency = get('#expense-currency').value
	const currency = selectedCurrency === 'Soles' ? 'PEN' : selectedCurrency === 'Dólares' ? 'USD' : selectedCurrency
	const isUsd = (value) => value === 'USD' || value === 'Dólares' || value === 'D�lares'
	const currencyExpenses = expenses.filter((expense) => (isUsd(expense.moneda) ? 'USD' : 'PEN') === currency)
	const total = currencyExpenses.reduce((sum, expense) => sum + Number(expense.monto || 0), 0)
	const categoryTotals = new Map()
	currencyExpenses.forEach((expense) => {
		const category = String(expense.categoria || '').trim() || 'Sin categoría'
		categoryTotals.set(category, (categoryTotals.get(category) || 0) + Number(expense.monto || 0))
	})
	const segments = [...categoryTotals].filter(([, value]) => value > 0)
	const colors = ['#d97706', '#c94f5e', '#e89b3c', '#f0bd69', '#b45309', '#dc7c5c']
	const stops = []
	let currentAngle = 0
	segments.forEach(([, value], index) => {
		const nextAngle = currentAngle + value / total * 360
		stops.push(`${colors[index % colors.length]} ${currentAngle}deg ${nextAngle}deg`)
		currentAngle = nextAngle
	})
	const donut = get('#expense-donut')
	donut.style.setProperty('--expense-chart', total > 0 ? stops.join(', ') : '#f3d6b6')
	donut.setAttribute('aria-label', `Egresos en ${currency === 'USD' ? 'dólares' : 'soles'}: ${amount(total, currency)}`)
	get('#expense-total').textContent = amount(total, currency)
	const legend = get('#expense-legend')
	legend.replaceChildren()
	if (segments.length) {
		segments.forEach(([category, subtotal], index) => {
			const row = document.createElement('div')
			row.className = 'expense-legend-item'
			const label = document.createElement('span')
			label.className = 'expense-legend-label'
			const dot = document.createElement('span')
			dot.className = 'expense-legend-dot'
			dot.style.backgroundColor = colors[index % colors.length]
			const labelText = document.createElement('span')
			labelText.textContent = category
			label.append(dot, labelText)
			const value = document.createElement('strong')
			value.textContent = amount(subtotal, currency)
			row.append(label, value)
			legend.appendChild(row)
		})
	} else {
		const row = document.createElement('div')
		row.className = 'expense-legend-item'
		const label = document.createElement('span')
		label.className = 'expense-legend-label'
		label.textContent = 'Sin egresos en este periodo'
		const value = document.createElement('strong')
		value.textContent = amount(0, currency)
		row.append(label, value)
		legend.appendChild(row)
	}
	const cash = [{ name: 'Caja soles', value: expenses.filter((expense) => !isUsd(expense.moneda)).reduce((sum, expense) => sum + Number(expense.monto || 0), 0), currency: 'PEN' }, { name: 'Caja dolares', value: expenses.filter((expense) => isUsd(expense.moneda)).reduce((sum, expense) => sum + Number(expense.monto || 0), 0), currency: 'USD' }].sort((a, b) => (a.value - b.value) * (subState.expenseSort === 'asc' ? 1 : -1))
	get('#expense-cash-list').innerHTML = cash.map((item) => `<div class="cash-row expense-cash-row"><span>${item.name}</span><strong>${amount(item.value, item.currency)}</strong></div>`).join('')
	get('#expense-count').textContent = `${expenses.length} ${expenses.length === 1 ? 'registro' : 'registros'}`
	get('#expense-list').innerHTML = expenses.length ? expenses.map((expense) => `<button class="expense-table expense-row expense-table-row" data-expense-id="${escapeValue(expense.id)}" type="button"><span><strong>${escapeValue(expense.concepto)}</strong></span><span>${displayDate(expense.fecha)}</span><span>${escapeValue(expense.categoria || 'Sin categoría')}</span><span>${escapeValue(expense.medio_pago || '-')}</span><span title="${escapeValue(expense.registrado_por_nombre || '-')}">${escapeValue(expense.registrado_por_nombre || '-')}</span><span>${isUsd(expense.moneda) ? 'Dólares' : 'Soles'}</span><strong>${amount(expense.monto, expense.moneda)}</strong></button>`).join('') : '<div class="finance-empty"><span>▱</span><strong>No se encontraron registros</strong><small>Puedes empezar creando uno</small></div>'
}
function ensureExpenseSelect(id, options) { const current = get(`#${id}`); if (current.tagName !== 'SELECT') { const select = document.createElement('select'); select.className = current.className; select.id = id; current.replaceWith(select) } get(`#${id}`).innerHTML = options }
function resetExpenseForm() { subState.expenseEditing = null; get('#expense-drawer-title').textContent = 'Nuevo egreso'; get('#expense-drawer-date').textContent = dateNow(); get('#expense-concept').value = ''; ensureExpenseSelect('expense-category', '<option value="">Seleccione</option><option value="Sin categoría">Sin categoría</option><option value="Insumos">Insumos</option><option value="Servicios">Servicios</option><option value="Personal">Personal</option>'); get('#expense-category').value = ''; get('#expense-date').value = dateNow(); get('#expense-money').innerHTML = '<option value="PEN">Soles</option><option value="USD">Dólares</option>'; get('#expense-money').value = 'PEN'; get('#expense-amount').value = ''; ensureExpenseSelect('expense-method', '<option value="">Seleccione</option><option>Efectivo</option><option>Tarjeta</option><option>Yape/Plin</option><option>Transferencia</option>'); get('#expense-method').value = ''; get('#expense-danger-zone').hidden = true }
function openExpenseDrawer(expense = null) { resetExpenseForm(); if (expense) { subState.expenseEditing = expense; get('#expense-drawer-title').textContent = 'Editar egreso'; get('#expense-drawer-date').textContent = expense.fecha; get('#expense-concept').value = expense.concepto || ''; get('#expense-category').value = expense.categoria || ''; get('#expense-date').value = String(expense.fecha || dateNow()).slice(0, 10); get('#expense-money').value = expense.moneda === 'USD' || expense.moneda === 'Dólares' || expense.moneda === 'D�lares' ? 'USD' : 'PEN'; get('#expense-amount').value = expense.monto || ''; get('#expense-method').value = expense.medio_pago || ''; get('#expense-danger-zone').hidden = false } get('#expense-drawer').hidden = false }
async function saveExpense() { const concept = get('#expense-concept').value.trim(); const amountValue = Number(get('#expense-amount').value); if (!concept || !amountValue) { toast('Completa el concepto y el monto'); return } try { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; const payload = { concepto: concept, categoria: get('#expense-category').value || null, fecha: get('#expense-date').value || dateNow(), moneda: get('#expense-money').value === 'USD' ? 'USD' : 'PEN', monto: amountValue, medio_pago: get('#expense-method').value || null, registrado_por: user.id, registrado_por_nombre: user.email || null }; const result = subState.expenseEditing ? await supabase.from('egresos').update(payload).eq('id', subState.expenseEditing.id).eq('registrado_por', user.id) : await supabase.from('egresos').insert(payload); if (result.error) throw result.error; get('#expense-drawer').hidden = true; toast(subState.expenseEditing ? 'Egreso actualizado' : 'Egreso guardado'); await loadExpenses() } catch (error) { console.error(error); toast(`No se pudo guardar el egreso: ${error.message}`) } }
async function deleteExpense() { if (!subState.expenseEditing) return; const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; const { error } = await supabase.from('egresos').delete().eq('id', subState.expenseEditing.id).eq('registrado_por', user.id); if (error) { toast(`No se pudo eliminar: ${error.message}`); return } get('#expense-drawer').hidden = true; await loadExpenses(); toast('Egreso eliminado') }
function renderExpenseDetail(expense) { const isUsd = expense.moneda === 'USD' || expense.moneda === 'Dólares' || expense.moneda === 'D�lares'; get('#expense-detail-title').textContent = expense.concepto; get('#expense-detail-number').textContent = `Egreso #${expense.id}`; get('#expense-detail-card').innerHTML = `<section class="detail-section"><header><h2>Egreso</h2></header><div class="detail-table expense-detail-table"><span>Concepto</span><span>Fecha</span><span>Monto</span></div><div class="detail-table expense-detail-table"><strong>${escapeValue(expense.concepto)}</strong><span>${displayDate(expense.fecha)}</span><strong>${amount(expense.monto, expense.moneda)}</strong></div></section>`; get('#expense-info-sidebar').innerHTML = `<div class="info-block"><h2>Detalles</h2><p>▣ ${displayDate(expense.fecha)}</p><p>ⓘ ${escapeValue(expense.medio_pago || 'Sin medio de pago')}</p><p>◉ ${isUsd ? 'Dólares' : 'Soles'}</p></div><div class="activity-block"><h2>Actividad</h2><p><strong>${escapeValue(expense.registrado_por_nombre || 'Usuario')}</strong> creó el egreso.<small>${displayDate(expense.created_at || expense.fecha)}</small></p></div>` }
function openExpenseDetail(id) { const expense = subState.expenses.find((item) => String(item.id) === String(id)); if (!expense) return; subState.expenseEditing = expense; hideFinanceViews(); get('#expense-detail-view').hidden = false; renderExpenseDetail(expense); window.history.replaceState({}, '', `finanzas.html?egreso=${encodeURIComponent(id)}`) }
const financeViewIds = ['tab-comprobantes', 'receipt-detail-view', 'expense-detail-view', 'tab-ingresos', 'tab-egresos', 'tab-proformas', 'proforma-detail-view']
function hideFinanceViews() { financeViewIds.forEach((id) => { const view = get(`#${id}`); if (view) view.hidden = true }) }
function updateFinanceControls(tabName) { const hideControls = tabName === 'ingresos' || tabName === 'egresos' || tabName === 'proformas'; const deletedToggle = get('#deleted-toggle'); if (deletedToggle) deletedToggle.hidden = hideControls; if (hideControls) all('[data-menu="income-sort-menu"], [data-menu="expense-sort-menu"], #income-sort-menu, #expense-sort-menu').forEach((control) => control.remove()) }
function activateTab(tabName) { const activeTab = get(`#tab-${tabName}`); if (!activeTab) return; hideFinanceViews(); activeTab.hidden = false; updateFinanceControls(tabName); all('.finance-tab').forEach((tab) => { const active = tab.dataset.tab === tabName; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)) }); if (tabName === 'ingresos') loadIncomeData(); if (tabName === 'egresos') loadExpenses(); if (tabName === 'proformas') loadProformas(); window.history.replaceState({}, '', `finanzas.html#${tabName}`) }
function bindSubfinance() { all('.finance-tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab))); get('#income-currency').addEventListener('change', renderIncome); get('#expense-currency').addEventListener('change', renderExpenses); get('#income-apply').addEventListener('click', loadIncomeData); get('#expense-apply').addEventListener('click', loadExpenses); get('#income-clear-dates').addEventListener('click', () => { get('#income-date-from').value = ''; get('#income-date-to').value = ''; loadIncomeData() }); get('#expense-clear-dates').addEventListener('click', () => { get('#expense-date-from').value = ''; get('#expense-date-to').value = ''; loadExpenses() }); get('#income-sort-menu').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { subState.incomeSort = button.dataset.incomeSort; get('#income-sort-menu').hidden = true; renderIncome() })); get('#expense-sort-menu').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { subState.expenseSort = button.dataset.expenseSort; get('#expense-sort-menu').hidden = true; renderExpenses() })); all('[data-menu]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); const menu = get(`#${button.dataset.menu}`); all('.sort-menu').filter((item) => item !== menu).forEach((item) => { item.hidden = true }); menu.hidden = !menu.hidden })); document.addEventListener('click', (event) => { if (!event.target.closest('[data-menu], .sort-menu')) all('.sort-menu').forEach((menu) => { menu.hidden = true }) }); get('#export-income').addEventListener('click', exportIncome); get('#expense-search').addEventListener('input', applyExpenseSearch); get('#expense-search-button').addEventListener('click', applyExpenseSearch); get('#sort-expense').addEventListener('click', () => { subState.expenseSort = subState.expenseSort === 'asc' ? 'desc' : 'asc'; renderExpenses() }); get('#new-expense').addEventListener('click', () => openExpenseDrawer()); get('#close-expense-drawer').addEventListener('click', () => { get('#expense-drawer').hidden = true }); get('#cancel-expense').addEventListener('click', () => { get('#expense-drawer').hidden = true }); get('#save-expense').addEventListener('click', saveExpense); get('#delete-expense').addEventListener('click', deleteExpense); get('#expense-list').addEventListener('click', (event) => { const row = event.target.closest('[data-expense-id]'); if (row) openExpenseDetail(row.dataset.expenseId) }); get('#edit-expense').addEventListener('click', () => openExpenseDrawer(subState.expenseEditing)); get('#back-to-expenses').addEventListener('click', () => { get('#expense-detail-view').hidden = true; get('#expense-view').hidden = false; window.history.pushState({}, '', 'finanzas.html'); loadExpenses() }) }
function bindReceiptBackGuard() { get('#back-to-receipts').addEventListener('click', () => { hideFinanceViews(); get('#tab-comprobantes').hidden = false; updateFinanceControls('comprobantes'); all('.finance-tab').forEach((tab) => { const active = tab.dataset.tab === 'comprobantes'; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)) }); window.history.pushState({}, '', 'finanzas.html') }) }
async function initSubfinance() { bindSubfinance(); bindProformaEvents(); get('#export-expense')?.addEventListener('click', exportExpenses); bindReceiptBackGuard(); const params = new URLSearchParams(window.location.search); const expenseId = params.get('egreso'); const proformaId = params.get('proforma'); const initialTab = window.location.hash.slice(1); if (expenseId) { activateTab('egresos'); await loadExpenses(); openExpenseDetail(expenseId) } else if (proformaId) { await loadProformas(); openProformaDetail(proformaId) } else if (['comprobantes', 'ingresos', 'egresos', 'proformas'].includes(initialTab)) activateTab(initialTab) }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSubfinance, { once: true }); else initSubfinance()
document.querySelector('#expense-donut')?.classList.add('expense-donut')
document.querySelector('#deleted-toggle')?.addEventListener('click', () => { document.querySelector('#deleted-toggle').textContent = state.showDeleted ? '← Volver a comprobantes' : '🗑 Ver eliminados' })
