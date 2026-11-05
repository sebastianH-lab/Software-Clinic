import { clearClientStorage, requireAuthenticatedUser, supabase } from './supabase.js'
import { validarDatosClinicosPaciente } from './validaciones-clinicas.js'

// 1. Obtener ID del paciente de la URL (?id=...)
const params = new URLSearchParams(window.location.search)
const pacienteId = params.get('id')
let comprobantesPaciente = []
let citasPaciente = []
let pacienteActual = null
let ultimaAtencionActual = null

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

function extraerCampoSerializado(text, label) {
	const prefix = `${label}:`
	const line = String(text || '').split('\n').find(value => value.startsWith(prefix))
	return line ? line.slice(prefix.length).trim() : ''
}

function agregarCampoExpediente(container, label, value) {
	const field = document.createElement('div')
	field.className = 'patient-background-field'
	const title = document.createElement('small')
	title.textContent = label
	const text = document.createElement('p')
	text.textContent = Array.isArray(value) ? value.join(', ') || 'Sin registro' : value || 'Sin registro'
	field.append(title, text)
	container.appendChild(field)
}

function crearBloqueCaso(container, step, title, fields) {
	const section = document.createElement('section')
	section.className = 'clinical-step-card'
	const heading = document.createElement('h3')
	heading.textContent = `${step} · ${title}`
	section.appendChild(heading)
	fields.forEach(([label, value]) => {
		const field = document.createElement('div')
		field.className = 'clinical-step-field'
		const fieldTitle = document.createElement('strong')
		fieldTitle.textContent = label
		const text = document.createElement('p')
		text.textContent = value || 'Sin registro'
		field.append(fieldTitle, text)
		section.appendChild(field)
	})
	container.appendChild(section)
}

function renderizarResumenCaso(atencion, diagnosticos, tratamientos) {
	const container = document.getElementById('clinical-case-summary')
	container.replaceChildren()
	if (!atencion) {
		container.innerHTML = '<p class="empty-text">Todavía no hay un caso clínico registrado.</p>'
		return
	}
	const vitals = [
		`P. arterial: ${mostrarValor(atencion.pa_presion, ' mmHg')}`,
		`F. cardíaca: ${mostrarValor(atencion.f_cardiaca, ' lpm')}`,
		`F. respiratoria: ${mostrarValor(atencion.f_respiratoria, ' rpm')}`,
		`Saturación: ${mostrarValor(atencion.saturacion, ' %')}`,
		`Temperatura: ${mostrarValor(atencion.temperatura, ' °C')}`,
	].join(' · ')
	const diagnosesText = diagnosticos.length
		? diagnosticos.map(item => `${item.descripcion || 'Sin descripción'}${item.cie10 ? ` (${item.cie10})` : ''} · ${item.tipo || 'Sin tipo'}`).join('\n')
		: ''
	const treatmentText = tratamientos.map(item => [
		item.medicamento_nombre,
		item.dosis_cantidad,
		item.dosis_unidad,
		item.via,
		item.frecuencia_horas ? `cada ${item.frecuencia_horas} h` : '',
		item.duracion_dias ? `${item.duracion_dias} días` : '',
	].filter(Boolean).join(' · ')).join('\n')
	const stepFive = atencion.paso_5_evolucion || ''
	const fechaControl = extraerCampoSerializado(stepFive, 'Fecha del próximo control')
	const horaControl = extraerCampoSerializado(stepFive, 'Hora del próximo control')
	const fechaControlText = fechaControl
		? `${new Date(`${fechaControl}T12:00:00`).toLocaleDateString('es-PE')}${horaControl ? ` · ${horaControl}` : ''}`
		: ''
	crearBloqueCaso(container, 'Paso 1', 'Valoración e identificación del problema', [
		['Motivo de consulta, examen físico y valoración por sistemas', atencion.paso_1_valoracion],
		['Relato del caso', textoPlano(atencion.relato)],
		['Funciones vitales', vitals],
	])
	crearBloqueCaso(container, 'Paso 2', 'Diagnóstico clínico', [
		['Diagnósticos y CIE-10', diagnosesText],
		['Juicio clínico', atencion.paso_2_diagnostico_notas],
	])
	crearBloqueCaso(container, 'Paso 3', 'Plan de trabajo con prioridades', [
		['Objetivos y prioridades', atencion.paso_3_plan_prioridades],
		['Plan de tratamiento', atencion.plan_tratamiento],
		['Exámenes auxiliares', atencion.examenes_auxiliares],
		['Prescripción médica', treatmentText],
	])
	crearBloqueCaso(container, 'Paso 4', 'Ejecución asistencial', [
		['Procedimientos e indicaciones', atencion.paso_4_ejecucion],
	])
	crearBloqueCaso(container, 'Paso 5', 'Evolución y seguimiento', [
		['Evolución SOAP y seguimiento', stepFive],
		['Criterios de alta', extraerCampoSerializado(stepFive, 'Criterios de alta')],
		['Próximo control', fechaControlText],
	])
}

function renderizarEvoluciones(evoluciones) {
	const list = document.getElementById('clinical-evolution-list')
	list.replaceChildren()
	if (!evoluciones.length) {
		list.innerHTML = '<p class="empty-text">No hay notas de seguimiento adicionales.</p>'
		return
	}
	evoluciones.forEach(item => {
		const entry = document.createElement('article')
		entry.className = 'clinical-evolution-entry'
		const date = document.createElement('time')
		date.textContent = item.fecha_evolucion ? new Date(item.fecha_evolucion).toLocaleString('es-PE') : 'Fecha no registrada'
		const details = document.createElement('p')
		details.textContent = item.nota_evolucion || 'Sin apreciación registrada'
		entry.append(date, details)
		;[['Subjetivo', item.subjetivo], ['Objetivo', item.objetivo], ['Plan ajustado', item.plan_ajustado]].forEach(([label, value]) => {
			if (!value) return
			const field = document.createElement('p')
			const strong = document.createElement('strong')
			strong.textContent = `${label}: `
			field.append(strong, document.createTextNode(value))
			entry.appendChild(field)
		})
		list.appendChild(entry)
	})
}

async function cargarUltimaAtencion() {
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return null
	const { data: atencion, error } = await supabase.from('atenciones').select('*').eq('paciente_id', pacienteId).eq('registrado_por', activeUser.id).order('created_at', { ascending: false }).limit(1).maybeSingle()

	if (error) {
		console.error('Error al cargar la última atención:', error.message)
		return null
	}
	if (!atencion) {
		ultimaAtencionActual = null
		renderizarResumenCaso(null, [], [])
		renderizarEvoluciones([])
		document.getElementById('evolution-followup-form').hidden = true
		return null
	}
	const [{ data: diagnosticos, error: diagnosisError }, { data: tratamientos, error: treatmentError }, { data: evoluciones, error: evolutionError }] = await Promise.all([
		supabase.from('atencion_diagnosticos').select('*').eq('atencion_id', atencion.id),
		supabase.from('atencion_tratamientos').select('*').eq('atencion_id', atencion.id),
		supabase.from('atencion_evoluciones').select('*').eq('atencion_id', atencion.id).eq('registrado_por', activeUser.id).order('fecha_evolucion', { ascending: false }),
	])
	const relationError = diagnosisError || treatmentError || evolutionError
	if (relationError) {
		console.error('Error al cargar los detalles clínicos de la atención:', relationError.message)
		document.getElementById('clinical-case-summary').textContent = `No se pudo cargar el expediente clínico: ${relationError.message}`
		return null
	}
	ultimaAtencionActual = atencion

	document.getElementById('latest-attention-date').textContent = new Date(atencion.created_at).toLocaleDateString('es-ES')
	const latestEditedBadge = document.getElementById('latest-attention-edited-badge')
	latestEditedBadge.hidden = !atencion.editado
	latestEditedBadge.title = atencion.fecha_edicion ? `Editado el ${new Date(atencion.fecha_edicion).toLocaleString('es-ES')}` : ''
	const latestBody = document.getElementById('latest-attention-body')
	latestBody.replaceChildren()
	const summary = document.createElement('p')
	summary.className = 'latest-attention-summary'
	summary.textContent = textoPlano(atencion.relato) || atencion.plan_tratamiento || 'Sin relato ni plan registrado.'
	latestBody.appendChild(summary)
	const vitals = document.createElement('div')
	vitals.className = 'latest-attention-meta'
	;[['P. arterial', atencion.pa_presion, ' mmHg'], ['F. cardiaca', atencion.f_cardiaca, ' lpm'], ['Saturación', atencion.saturacion, ' %'], ['Temperatura', atencion.temperatura, ' °C']].forEach(([label, value, suffix]) => {
		const item = document.createElement('div')
		const title = document.createElement('small')
		title.textContent = label
		const detail = document.createElement('strong')
		detail.textContent = mostrarValor(value, suffix)
		item.append(title, detail)
		vitals.appendChild(item)
	})
	latestBody.appendChild(vitals)
	renderizarResumenCaso(atencion, diagnosticos || [], tratamientos || [])
	renderizarEvoluciones(evoluciones || [])
	document.getElementById('evolution-followup-form').hidden = false

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
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
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
		.eq('registrado_por', activeUser.id)
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
	const background = document.getElementById('patient-medical-background')
	background.replaceChildren()
	agregarCampoExpediente(background, 'Fecha de ingreso', p.fecha_ingreso ? new Date(`${p.fecha_ingreso}T12:00:00`).toLocaleDateString('es-PE') : '')
	agregarCampoExpediente(background, 'Domicilio', p.domicilio)
	agregarCampoExpediente(background, 'Antecedentes personales / patológicos', p.antecedentes_patologicos)
	agregarCampoExpediente(background, 'Antecedentes quirúrgicos', p.antecedentes_quirurgicos)
	agregarCampoExpediente(background, 'Antecedentes familiares', p.antecedentes_familiares)
	agregarCampoExpediente(background, 'Alergias', p.alergias)
	agregarCampoExpediente(background, 'Medicación habitual', p.medicacion_habitual)
	document.getElementById('archive-patient-zone').hidden = p.activo === false
	document.getElementById('restore-patient-zone').hidden = p.activo !== false

	await cargarUltimaAtencion()

	console.log('Perfil cargado:', p.nombre_completo)
}

cargarPerfil()

document.getElementById('evolution-followup-form').addEventListener('submit', async event => {
	event.preventDefault()
	if (!ultimaAtencionActual) {
		alert('Registra una atención antes de agregar una nota de seguimiento.')
		return
	}
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	const form = event.currentTarget
	const formData = new FormData(form)
	const apreciacion = String(formData.get('apreciacion') || '').trim()
	if (!apreciacion) {
		form.querySelector('[name="apreciacion"]').focus()
		return
	}
	const submitButton = form.querySelector('button[type="submit"]')
	submitButton.disabled = true
	try {
		const { error } = await supabase.from('atencion_evoluciones').insert({
			atencion_id: ultimaAtencionActual.id,
			paciente_id: pacienteId,
			nota_evolucion: `Apreciación clínica: ${apreciacion}`,
			subjetivo: String(formData.get('subjetivo') || '').trim() || null,
			objetivo: String(formData.get('objetivo') || '').trim() || null,
			plan_ajustado: String(formData.get('plan_ajustado') || '').trim() || null,
			registrado_por: activeUser.id,
		})
		if (error) throw error
		form.reset()
		await cargarUltimaAtencion()
	} catch (error) {
		console.error('Error al guardar la evolución clínica:', error)
		alert(`No se pudo guardar la evolución: ${error.message}`)
	} finally {
		submitButton.disabled = false
	}
})

// ==================== PESTAÑAS DEL PERFIL ====================
const tabBtns = document.querySelectorAll('.tab-btn')
const tabPanes = document.querySelectorAll('.tab-pane')
let atencionDetalleActual = null
let diagnosticosDetalleActual = []
let tratamientosDetalleActual = []
let evolucionesDetalleActual = []
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
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return false
	const { error } = await supabase
		.from('pacientes')
		.update({ activo })
		.eq('id', pacienteId)
		.eq('registrado_por', activeUser.id)

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
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	content.innerHTML = '<p class="empty-text">Cargando comprobantes...</p>'

	const { data, error } = await supabase
		.from('comprobantes')
		.select('*, comprobante_detalles(*), comprobante_pagos(*)')
		.eq('paciente_id', pacienteId)
		.eq('registrado_por', activeUser.id)
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
				<td><div class="patient-receipt-actions"><button class="patient-receipt-pdf" type="button" data-receipt-pdf="${escaparHtml(receipt.id)}">Descargar PDF</button><button class="patient-receipt-view" type="button" data-open-receipt="${escaparHtml(receipt.id)}">Ver Recibo</button></div></td>
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
	const button = event.target.closest('[data-receipt-pdf], [data-open-receipt]')
	if (!button) return
	const receiptId = button.dataset.receiptPdf || button.dataset.openReceipt
	const receipt = comprobantesPaciente.find((item) => String(item.id) === receiptId)
	if (!receipt) return
	if (button.hasAttribute('data-receipt-pdf')) descargarNotaVenta(receipt)
	else window.location.href = `sub/finanzas.html?id=${encodeURIComponent(receipt.id)}`
})

async function cargarAgendaPaciente(id) {
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	const list = document.getElementById('patient-agenda-list')
	if (!id) return
	citasPaciente = []
	list.innerHTML = '<p class="empty-text">Cargando citas...</p>'

	const { data: citas, error } = await supabase
		.from('citas')
		.select('*')
		.eq('paciente_id', id)
		.eq('registrado_por', activeUser.id)
		.order('fecha', { ascending: false })
		.order('hora_inicio', { ascending: false })

	if (error) {
		list.innerHTML = `<p class="empty-text">No se pudieron cargar las citas: ${escaparHtml(error.message)}</p>`
		return
	}

	citasPaciente = citas || []
	document.getElementById('agenda-count').textContent = `${citasPaciente.length} ${citasPaciente.length === 1 ? 'cita' : 'citas'}`
	if (!citasPaciente.length) {
		list.innerHTML = '<p class="empty-text">No hay citas registradas para este paciente</p>'
		return
	}

	list.innerHTML = citasPaciente.map(cita => {
		const estado = cita.estado || 'Pendiente'
		const fecha = cita.fecha ? new Date(`${cita.fecha}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Fecha no registrada'
		const hora = cita.hora_inicio || '--:--'
		const horaFin = cita.hora_fin ? ` - ${cita.hora_fin}` : ''
		return `<article class="patient-appointment"><div class="patient-appointment-date">${escaparHtml(fecha)}<small>${escaparHtml(hora)}${escaparHtml(horaFin)}</small></div><div class="patient-appointment-type">${escaparHtml(cita.tipo_cita || 'Consulta')}</div><div class="patient-appointment-actions"><span class="appointment-status ${normalizarEstadoCita(estado)}">${escaparHtml(estado)}</span><button class="patient-appointment-edit" type="button" data-edit-appointment="${escaparHtml(cita.id)}">Modificar Cita</button></div></article>`
	}).join('')
}

function abrirEdicionCita(cita) {
	document.getElementById('edit-appointment-id').value = String(cita.id)
	document.getElementById('edit-appointment-status').value = cita.estado || 'Pendiente'
	document.getElementById('edit-appointment-date').value = cita.fecha || ''
	document.getElementById('edit-appointment-time').value = (cita.hora_inicio || '').slice(0, 5)
	const modal = document.getElementById('appointment-edit-modal')
	modal.classList.add('is-open')
	modal.setAttribute('aria-hidden', 'false')
	document.getElementById('appointment-edit-backdrop').hidden = false
	document.getElementById('edit-appointment-status').focus()
}

function cerrarEdicionCita() {
	const modal = document.getElementById('appointment-edit-modal')
	modal.classList.remove('is-open')
	modal.setAttribute('aria-hidden', 'true')
	document.getElementById('appointment-edit-backdrop').hidden = true
}

document.getElementById('patient-agenda-list').addEventListener('click', (event) => {
	const button = event.target.closest('[data-edit-appointment]')
	if (!button) return
	const cita = citasPaciente.find((item) => String(item.id) === button.dataset.editAppointment)
	if (cita) abrirEdicionCita(cita)
})

document.getElementById('appointment-edit-form').addEventListener('submit', async (event) => {
	event.preventDefault()
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	const appointmentId = document.getElementById('edit-appointment-id').value
	const fecha = document.getElementById('edit-appointment-date').value
	const hora = document.getElementById('edit-appointment-time').value
	if (!appointmentId || !fecha || !hora) return

	const { data, error } = await supabase
		.from('citas')
		.update({
			estado: document.getElementById('edit-appointment-status').value,
			fecha,
			hora_inicio: `${hora}:00`,
		})
		.eq('id', appointmentId)
		.eq('paciente_id', pacienteId)
		.eq('registrado_por', activeUser.id)
		.select('id')
		.maybeSingle()

	if (error) {
		console.error('Error al actualizar la cita:', error.message)
		alert(`No se pudo actualizar la cita: ${error.message}`)
		return
	}
	if (!data) {
		alert('No se encontró la cita o no tienes permiso para modificarla.')
		return
	}
	cerrarEdicionCita()
	await cargarAgendaPaciente(pacienteId)
})

document.getElementById('close-appointment-edit').addEventListener('click', cerrarEdicionCita)
document.getElementById('cancel-appointment-edit').addEventListener('click', cerrarEdicionCita)
document.getElementById('appointment-edit-backdrop').addEventListener('click', cerrarEdicionCita)
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') cerrarEdicionCita()
})

const drawer = document.getElementById('attention-drawer')
const backdrop = document.getElementById('attention-backdrop')
const attentionForm = document.getElementById('attention-form')
const stepButtons = document.querySelectorAll('.attention-step')
const sections = document.querySelectorAll('.attention-section')
const nextButton = document.getElementById('next-attention-button')
const diagnosisList = document.getElementById('diagnosis-list')
const treatmentList = document.getElementById('treatment-list')
const objectivesList = document.getElementById('objectives-list')
const validationToast = document.getElementById('attention-validation-toast')
const nextControlDate = attentionForm.elements.fecha_proximo_control
const nextControlTime = attentionForm.elements.hora_proximo_control
const today = new Date()
nextControlDate.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
let currentStep = 0
const stepNames = ['valoracion', 'diagnostico', 'plan', 'ejecucion', 'evolucion']

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
	const motivoConsulta = attentionForm.elements.motivo_consulta
	const planTratamiento = attentionForm.elements.plan_tratamiento
	const apreciacion = attentionForm.elements.evolucion_apreciacion
	const diagnosticos = [...document.querySelectorAll('.diagnosis-description')]
	const objetivos = [...document.querySelectorAll('.objective-description')]
	if (!diagnosticos.length) {
		agregarDiagnostico()
		diagnosticos.push(document.querySelector('.diagnosis-description'))
	}
	if (!objetivos.length) {
		agregarObjetivo()
		objetivos.push(document.querySelector('.objective-description'))
	}
	const diagnosticoValido = diagnosticos.some(control => control.value.trim())
	const objetivoValido = objetivos.some(control => control.value.trim())
	const invalidos = []

	if (!motivoConsulta.value.trim()) invalidos.push(motivoConsulta)
	if (!textoPlano(relatoEditor.innerHTML).trim()) invalidos.push(relatoEditor)
	if (!diagnosticoValido) invalidos.push(diagnosticos[0])
	if (!objetivoValido) invalidos.push(objetivos[0])
	if (!planTratamiento.value.trim()) invalidos.push(planTratamiento)
	if (!apreciacion.value.trim()) invalidos.push(apreciacion)
	if (nextControlDate.value && !nextControlTime.value) invalidos.push(nextControlTime)
	if (nextControlTime.value && !nextControlDate.value) invalidos.push(nextControlDate)
	if (nextControlDate.value && nextControlDate.value < nextControlDate.min) invalidos.push(nextControlDate)

	attentionForm.querySelectorAll('.field-invalid').forEach(limpiarErrorValidacion)
	if (!invalidos.length) return true

	attentionForm.dataset.validationAttempted = 'true'
	invalidos.forEach(marcarErrorValidacion)
	const invalidSection = invalidos[0].closest('.attention-section')
	if (invalidSection) mostrarPaso(stepNames.indexOf(invalidSection.dataset.section))
	validationToast.textContent = 'Complete los campos requeridos y elija fecha y hora juntas para agendar el próximo control.'
	validationToast.classList.add('is-visible')
	window.clearTimeout(validationToast.hideTimeout)
	validationToast.hideTimeout = window.setTimeout(() => validationToast.classList.remove('is-visible'), 4000)
	invalidos[0].focus()
	return false
}

function mostrarPaso(index) {
	index = Math.max(0, Math.min(index, stepNames.length - 1))
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
	if (target.classList.contains('objective-description')) {
		const objectives = [...document.querySelectorAll('.objective-description')]
		if (objectives.some(control => control.value.trim())) {
			objectives.forEach(control => limpiarErrorValidacion(control))
		} else if (attentionForm.dataset.validationAttempted) {
			marcarErrorValidacion(objectives[0])
		}
	}
	if (target.name === 'motivo_consulta' || target.name === 'evolucion_apreciacion') {
		if (target.value.trim()) limpiarErrorValidacion(target)
		else if (attentionForm.dataset.validationAttempted) marcarErrorValidacion(target)
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
	if (!objectivesList.children.length) agregarObjetivo()
	if (!treatmentList.children.length) agregarTratamiento()
	mostrarPaso(0)
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

function agregarObjetivo() {
	const row = document.createElement('div')
	row.className = 'dynamic-row objective-row'
	row.innerHTML = '<div class="row-top"><strong>Objetivo terapéutico</strong><button class="remove-row" type="button">Eliminar</button></div><div class="dynamic-row-grid"><label class="drawer-field">Objetivo<textarea class="objective-description" rows="2" placeholder="Resultado terapéutico esperado"></textarea></label><label class="drawer-field">Prioridad<select class="objective-priority"><option value="Alta">Alta</option><option value="Media" selected>Media</option><option value="Baja">Baja</option></select></label></div>'
	row.querySelector('.remove-row').addEventListener('click', () => row.remove())
	objectivesList.appendChild(row)
}

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
	row.innerHTML = `<div class="row-top"><strong>Diagnóstico</strong><button class="remove-row" type="button">Eliminar</button></div><div class="dynamic-row-grid"><label class="drawer-field">Descripción<input class="diagnosis-description" type="text" placeholder="Ej. Hipertensión arterial"></label><label class="drawer-field">Código CIE-10<input class="diagnosis-code" type="text" list="cie10-codes" placeholder="Buscar o ingresar código"></label></div><div class="radio-group"><label class="radio-option"><input type="radio" name="${radioName}" value="Presuntivo" checked> Presuntivo</label><label class="radio-option"><input type="radio" name="${radioName}" value="Definitivo"> Definitivo</label><label class="radio-option"><input type="radio" name="${radioName}" value="Recurrente"> Recurrente</label></div>`
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
document.getElementById('add-objective-button').addEventListener('click', agregarObjetivo)

function obtenerObjetivos() {
	const prioridadOrden = { Alta: 0, Media: 1, Baja: 2 }
	return Array.from(document.querySelectorAll('.objective-row')).map(row => ({
		objetivo: row.querySelector('.objective-description').value.trim(),
		prioridad: row.querySelector('.objective-priority').value,
	})).filter(item => item.objetivo).sort((a, b) => prioridadOrden[a.prioridad] - prioridadOrden[b.prioridad])
}

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

function serializarCampos(etiquetas) {
	return etiquetas
		.filter(([, value]) => value)
		.map(([label, value]) => `${label}: ${value}`)
		.join('\n')
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
	const objectives = obtenerObjetivos()
	const stepOne = serializarCampos([
		['Motivo de consulta', valorFormulario('motivo_consulta')],
		['Examen físico', valorFormulario('examen_fisico')],
		['Valoración por sistemas', valorFormulario('valoracion_sistemas')],
	])
	const stepThree = objectives
		.map(item => `${item.prioridad}: ${item.objetivo}`)
		.join('\n')
	const stepFour = serializarCampos([
		['Procedimientos, curaciones e intervenciones ejecutadas', valorFormulario('procedimientos_ejecutados')],
		['Indicaciones brindadas al paciente', valorFormulario('indicaciones_paciente')],
	])
	const stepFive = serializarCampos([
		['Subjetivo', valorFormulario('evolucion_subjetiva')],
		['Objetivo', valorFormulario('evolucion_objetiva')],
		['Apreciación clínica', valorFormulario('evolucion_apreciacion')],
		['Plan de seguimiento', valorFormulario('evolucion_plan')],
		['Criterios de alta', valorFormulario('criterios_alta')],
		['Fecha del próximo control', valorFormulario('fecha_proximo_control')],
		['Hora del próximo control', valorFormulario('hora_proximo_control')],
	])
	const atencion = {
		paciente_id: pacienteId,
		relato: document.getElementById('relato-editor').innerHTML.trim() || null,
		archivos_urls: archivosUrls.length ? archivosUrls : null,
		paso_1_valoracion: stepOne || null,
		paso_2_diagnostico_notas: valorFormulario('diagnostico_notas'),
		paso_3_plan_prioridades: stepThree || null,
		paso_4_ejecucion: stepFour || null,
		paso_5_evolucion: stepFive || null,
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
	const { error: evolutionError } = await supabase.from('atencion_evoluciones').insert({
		atencion_id: savedAttention.id,
		paciente_id: pacienteId,
		nota_evolucion: `Apreciación clínica: ${valorFormulario('evolucion_apreciacion')}`,
		subjetivo: valorFormulario('evolucion_subjetiva'),
		objetivo: valorFormulario('evolucion_objetiva'),
		plan_ajustado: valorFormulario('evolucion_plan'),
		registrado_por: user.id,
	})
	if (evolutionError) return manejarErrorGuardado(evolutionError)
	let appointmentSaveError = null
	let appointmentSaved = false
	if (valorFormulario('fecha_proximo_control') && valorFormulario('hora_proximo_control')) {
		const hora = valorFormulario('hora_proximo_control')
		const [hours, minutes] = hora.split(':').map(Number)
		const endMinutes = (hours * 60 + minutes + 60) % (24 * 60)
		const horaFin = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`
		const { error: appointmentError } = await supabase.from('citas').insert({
			paciente_id: pacienteId,
			doctor_id: null,
			fecha: valorFormulario('fecha_proximo_control'),
			hora_inicio: `${hora}:00`,
			hora_fin: horaFin,
			tipo_cita: 'Seguimiento',
			motivo: 'Control posterior a atención',
			estado: 'Pendiente',
			registrado_por: user.id,
		})
		if (appointmentError) {
			appointmentSaveError = appointmentError
			console.error('La atención se guardó, pero no se pudo agendar el próximo control:', appointmentError.message)
		} else {
			appointmentSaved = true
		}
	}
	await actualizarFuncionesVitales(atencion)
	alert(appointmentSaveError
		? `La atención se guardó, pero no se pudo agendar el control. Regístralo desde Agenda. Detalle: ${appointmentSaveError.message}`
		: 'Atención guardada correctamente.')
	attentionForm.reset()
	document.getElementById('relato-editor').innerHTML = ''
	document.getElementById('selected-files').replaceChildren()
	diagnosisList.innerHTML = ''
	treatmentList.innerHTML = ''
	objectivesList.innerHTML = ''
	cerrarDrawer()
	await cargarUltimaAtencion()
	await cargarHistorial()
	if (appointmentSaved) await cargarAgendaPaciente(pacienteId)
	nextButton.disabled = false
	nextButton.textContent = 'Siguiente'
	mostrarPaso(0)
}

function manejarErrorGuardado(error) {
	alert(`La atención se creó, pero no se pudieron guardar todos sus detalles. Revise las tablas y columnas de Supabase y vuelva a cargar el historial. Detalle: ${error.message}`)
	nextButton.disabled = false
	nextButton.textContent = 'Guardar atención'
}

async function actualizarFuncionesVitales(atencion) {
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	const vitales = Object.fromEntries(Object.entries({
		presion_arterial: atencion.pa_presion,
		frecuencia_cardiaca: atencion.f_cardiaca,
		frecuencia_respiratoria: atencion.f_respiratoria,
		saturacion_oxigeno: atencion.saturacion,
		temperatura: atencion.temperatura,
	}).filter(([, value]) => value !== null))
	if (Object.keys(vitales).length) {
		const { error } = await supabase.from('pacientes').update(vitales).eq('id', pacienteId).eq('registrado_por', activeUser.id)
		if (error) console.error('No se pudieron actualizar los signos vitales del paciente:', error.message)
	}
}

nextButton.addEventListener('click', () => {
	if (currentStep < stepNames.length - 1) mostrarPaso(currentStep + 1)
	else guardarAtencion()
})

async function cargarHistorial() {
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	const list = document.getElementById('history-list')
	list.innerHTML = '<p class="empty-text">Cargando historial...</p>'
	const { data, error } = await supabase.from('atenciones').select('*').eq('paciente_id', pacienteId).eq('registrado_por', activeUser.id).order('created_at', { ascending: false })
	if (error) {
		list.innerHTML = `<p class="empty-text">No se pudo cargar el historial: ${error.message}</p>`
		return
	}
	const attentions = data || []
	document.getElementById('history-count').textContent = `${attentions.length} consulta${attentions.length === 1 ? '' : 's'}`
	if (!attentions.length) {
		list.innerHTML = '<p class="empty-text">Todavía no hay atenciones registradas.</p>'
		return
	}
	list.innerHTML = ''
	attentions.forEach(item => {
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
	const activeUser = await requireAuthenticatedUser()
	if (!activeUser) return
	const [{ data: atencion, error: attentionError }, { data: diagnosticos, error: diagnosisError }, { data: tratamientos, error: treatmentError }, { data: evoluciones, error: evolutionError }] = await Promise.all([
		supabase.from('atenciones').select('*').eq('id', atencionId).eq('registrado_por', activeUser.id).single(),
		supabase.from('atencion_diagnosticos').select('*').eq('atencion_id', atencionId),
		supabase.from('atencion_tratamientos').select('*').eq('atencion_id', atencionId),
		supabase.from('atencion_evoluciones').select('*').eq('atencion_id', atencionId).eq('registrado_por', activeUser.id).order('fecha_evolucion', { ascending: false }),
	])
	if (attentionError || diagnosisError || treatmentError || evolutionError || !atencion) {
		const error = attentionError || diagnosisError || treatmentError || evolutionError
		console.error('Error al cargar detalle de atención:', error)
		alert(`No se pudo cargar el detalle de la consulta${error?.message ? `: ${error.message}` : '.'}`)
		return
	}

	atencionDetalleActual = atencion
	diagnosticosDetalleActual = diagnosticos || []
	tratamientosDetalleActual = tratamientos || []
	evolucionesDetalleActual = evoluciones || []
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

	const diagnosesText = diagnosticos.map(item => `${item.descripcion || 'Sin descripción'}${item.cie10 ? ` · ${item.cie10}` : ''} · ${item.tipo || 'Sin tipo'}`).join('\n')
	const treatmentsText = tratamientos.map(item => [
		item.medicamento_nombre,
		item.dosis_cantidad,
		item.dosis_unidad,
		item.via,
		item.frecuencia_horas ? `cada ${item.frecuencia_horas} h` : '',
		item.duracion_dias ? `${item.duracion_dias} días` : '',
	].filter(Boolean).join(' · ')).join('\n')
	const vitalsText = [
		`P. arterial: ${mostrarValor(atencion.pa_presion, ' mmHg')}`,
		`F. cardíaca: ${mostrarValor(atencion.f_cardiaca, ' lpm')}`,
		`F. respiratoria: ${mostrarValor(atencion.f_respiratoria, ' rpm')}`,
		`Saturación: ${mostrarValor(atencion.saturacion, ' %')}`,
		`Temperatura: ${mostrarValor(atencion.temperatura, ' °C')}`,
	].join(' · ')
	crearBloqueDetalle(content, 'Paso 1 · Valoración e identificación del problema', serializarCampos([
		['Valoración', atencion.paso_1_valoracion],
		['Relato del caso', textoPlano(atencion.relato)],
		['Funciones vitales', vitalsText],
	]))
	crearBloqueDetalle(content, 'Paso 2 · Diagnóstico clínico', serializarCampos([
		['Diagnósticos y CIE-10', diagnosesText],
		['Juicio clínico', atencion.paso_2_diagnostico_notas],
	]))
	crearBloqueDetalle(content, 'Paso 3 · Plan de trabajo con prioridades', serializarCampos([
		['Objetivos y prioridades', atencion.paso_3_plan_prioridades],
		['Plan de tratamiento', atencion.plan_tratamiento],
		['Exámenes auxiliares', atencion.examenes_auxiliares],
		['Prescripción médica', treatmentsText],
	]))
	crearBloqueDetalle(content, 'Paso 4 · Ejecución asistencial', atencion.paso_4_ejecucion)
	crearBloqueDetalle(content, 'Paso 5 · Evolución y seguimiento', atencion.paso_5_evolucion)
	if (evolucionesDetalleActual.length) {
		const evolutionText = evolucionesDetalleActual.map(item => [
			item.fecha_evolucion ? new Date(item.fecha_evolucion).toLocaleString('es-PE') : 'Fecha no registrada',
			item.nota_evolucion,
			item.subjetivo ? `Subjetivo: ${item.subjetivo}` : '',
			item.objetivo ? `Objetivo: ${item.objetivo}` : '',
			item.plan_ajustado ? `Plan ajustado: ${item.plan_ajustado}` : '',
		].filter(Boolean).join('\n')).join('\n\n')
		crearBloqueDetalle(content, 'Notas continuadas de evolución', evolutionText)
	}
}

function crearBloqueDetalle(container, title, text) {
	const block = document.createElement('section')
	block.className = 'detail-block'
	const heading = document.createElement('h3')
	heading.textContent = title
	const paragraph = document.createElement('p')
	paragraph.textContent = text || 'Sin registro.'
	block.append(heading, paragraph)
	container.appendChild(block)
}

function crearCampoEdicion(labelText, value, { multiline = false, type = 'text', step, list } = {}) {
	const label = document.createElement('label')
	label.className = 'attention-edit-field'
	label.textContent = labelText
	const input = document.createElement(multiline ? 'textarea' : 'input')
	if (!multiline) input.type = type
	if (step) input.step = step
	if (list) input.setAttribute('list', list)
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
	;[
		['Paso 1 · Valoración', 'Valoración, examen físico y sistemas', 'paso_1_valoracion'],
		['Paso 1 · Relato del caso', 'Relato del caso', 'relato'],
		['Paso 2 · Diagnóstico clínico', 'Juicio clínico', 'paso_2_diagnostico_notas'],
		['Paso 3 · Plan de trabajo con prioridades', 'Objetivos y prioridades', 'paso_3_plan_prioridades'],
		['Paso 4 · Ejecución asistencial', 'Procedimientos e indicaciones', 'paso_4_ejecucion'],
		['Paso 5 · Evolución y seguimiento', 'Evolución SOAP y seguimiento', 'paso_5_evolucion'],
	].forEach(([title, label, key]) => {
		const section = document.createElement('section')
		section.className = 'detail-block attention-edit-section'
		section.appendChild(Object.assign(document.createElement('h3'), { textContent: title }))
		const field = crearCampoEdicion(label, atencion[key], { multiline: true })
		field.dataset.field = key
		section.appendChild(field)
		content.appendChild(section)
	})
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
		['cie10', 'Código CIE-10', { list: 'cie10-codes' }],
		['tipo', 'Tipo'],
	])))
	const addDiagnosis = document.createElement('button')
	addDiagnosis.type = 'button'
	addDiagnosis.className = 'add-row-button'
	addDiagnosis.textContent = '＋ Agregar diagnóstico'
	addDiagnosis.addEventListener('click', () => diagnoses.appendChild(crearFilaEdicion('Diagnóstico', { tipo: 'Presuntivo' }, [
		['descripcion', 'Descripción'],
		['cie10', 'Código CIE-10', { list: 'cie10-codes' }],
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
		relato: valorCampoEdicion('relato'),
		paso_1_valoracion: valorCampoEdicion('paso_1_valoracion'),
		paso_2_diagnostico_notas: valorCampoEdicion('paso_2_diagnostico_notas'),
		paso_3_plan_prioridades: valorCampoEdicion('paso_3_plan_prioridades'),
		paso_4_ejecucion: valorCampoEdicion('paso_4_ejecucion'),
		paso_5_evolucion: valorCampoEdicion('paso_5_evolucion'),
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
			.eq('registrado_por', user.id)
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
