import { clearClientStorage, requireAuthenticatedUser, supabase } from './supabase.js'

const state = { selectedDate: new Date(), view: 'day', doctorId: '', doctors: [], patients: [], appointments: [], selectedPatient: null, selectedTime: '09:00' }
const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const todayKey = () => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` }
const formatDate = (date, options) => new Intl.DateTimeFormat('es-ES', options).format(date)
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
const age = (birthDate) => { if (!birthDate) return 'Edad no registrada'; const birth = new Date(birthDate); const today = new Date(); let result = today.getFullYear() - birth.getFullYear(); if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) result--; return `${result} años` }
const showToast = (message) => { const toast = $('#toast'); toast.textContent = message; toast.classList.add('is-visible'); window.setTimeout(() => toast.classList.remove('is-visible'), 3200) }
async function logout() { const { error } = await supabase.auth.signOut(); if (error) { showToast('No se pudo cerrar la sesión'); return } state.doctors = []; state.patients = []; state.appointments = []; state.selectedPatient = null; state.doctorId = ''; state.view = 'day'; state.selectedDate = new Date(); state.selectedTime = ''; document.body.replaceChildren(); clearClientStorage(); window.location.href = '../ingresar.html' }
function updateDateHeader() { const date = state.selectedDate; const month = formatDate(date, { month: 'long' }).replace(/^./, (char) => char.toUpperCase()); $('#selected-date-title').textContent = `${month} ${date.getDate()}, ${date.getFullYear()}`; $('#selected-day-title').textContent = formatDate(date, { weekday: 'long' }).replace(/^./, (char) => char.toUpperCase()); $('#date-picker').value = dateKey(date); $('#appointment-date').value = dateKey(date); renderMiniCalendar() }
function changeDate(offset) { const next = new Date(state.selectedDate); next.setDate(next.getDate() + offset); state.selectedDate = next; updateDateHeader(); loadAppointments() }
async function loadDoctors() { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; let profiles = []; const result = await supabase.from('profiles').select('*').order('full_name'); if (!result.error) profiles = result.data || []; if (!profiles.length) profiles = [{ id: user.id, full_name: user.user_metadata?.full_name || user.email || 'Usuario activo' }]; state.doctors = profiles; const options = `<option value="">Todos los doctores</option>${profiles.map((doctor) => `<option value="${escapeHtml(doctor.id)}">${escapeHtml(doctor.full_name || doctor.email || 'Doctor')}</option>`).join('')}`; $('#doctor-select').innerHTML = options; $('#sidebar-doctor').innerHTML = options; state.doctorId = ''; $('#doctor-select').value = ''; $('#sidebar-doctor').value = ''; const active = profiles[0]?.full_name || 'Usuario activo'; $('#sidebar-name').textContent = active; $('#sidebar-avatar').textContent = initials(active) }
async function loadPatients() { if (!await requireAuthenticatedUser('../ingresar.html')) return; const { data, error } = await supabase.from('pacientes').select('*').eq('activo', true).order('nombre_completo'); if (error) { console.error(error); showToast('No se pudieron cargar los pacientes'); return } state.patients = data || []; renderPatientPicker() }
async function loadAppointments() {
	if (!await requireAuthenticatedUser('../ingresar.html')) return
	const selectedDate = dateKey(state.selectedDate)
	const weekStart = new Date(state.selectedDate)
	weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
	const weekEnd = new Date(weekStart)
	weekEnd.setDate(weekStart.getDate() + 6)
	const fechaInicio = state.view === 'week' ? dateKey(weekStart) : selectedDate
	const fechaFin = state.view === 'week' ? dateKey(weekEnd) : selectedDate
	const doctorId = String(state.doctorId || '').trim()
	console.log("1. Filtros enviados a Supabase:", { fechaInicio, fechaFin, doctorId })

	let query = supabase
		.from('citas')
		.select('*, paciente:pacientes(nombre_completo, documento_identidad, genero, fecha_nacimiento, activo), doctor:profiles!citas_doctor_id_fkey(full_name)')
		.gte('fecha', fechaInicio)
		.lte('fecha', fechaFin)

	if (doctorId && doctorId !== 'todos' && doctorId !== '') {
		query = query.eq('doctor_id', doctorId)
	}

	const { data, error } = await query.order('fecha').order('hora_inicio')
	console.log("2. Respuesta cruda de Supabase:", data, error)

	if (error) {
		console.warn('No se pudieron cargar citas:', error.message)
		state.appointments = []
		renderDay()
		renderWeek()
		return
	}

	const appointments = await marcarCitasVencidas(data || [])
	const citasParaMostrar = appointments.filter((cita) => cita.paciente && cita.paciente.activo === true)
	state.appointments = citasParaMostrar

	renderDay()
	renderWeek()
}
async function marcarCitasVencidas(appointments) {
	const now = new Date()
	const expired = appointments.filter((appointment) => {
		if (appointmentStatus(appointment) !== 'pending' || !appointment.fecha) return false
		const startTime = appointment.hora_fin || appointment.hora_inicio || appointment.hora
		if (!startTime) return false
		const time = String(startTime).slice(0, 8)
		const scheduledEnd = new Date(`${String(appointment.fecha).slice(0, 10)}T${time.length === 5 ? `${time}:00` : time}`)
		if (Number.isNaN(scheduledEnd.getTime())) return false
		if (!appointment.hora_fin) scheduledEnd.setMinutes(scheduledEnd.getMinutes() + 60)
		return scheduledEnd < now
	})
	if (!expired.length) return appointments

	const results = await Promise.all(expired.map(async (appointment) => {
		const { data, error } = await supabase.from('citas')
			.update({ estado: 'No asistió' })
			.eq('id', appointment.id)
			.eq('estado', appointment.estado)
			.select('id')
			.maybeSingle()
		if (error) {
			console.error(`No se pudo marcar como ausente la cita ${appointment.id}:`, error)
			return null
		}
		return data?.id || null
	}))
	const updatedIds = new Set(results.filter(Boolean).map(String))
	return appointments.map((appointment) => updatedIds.has(String(appointment.id)) ? { ...appointment, estado: 'No asistió' } : appointment)
}
function appointmentPatient(appointment) { return appointment.paciente || appointment.pacientes || state.patients.find((patient) => patient.id === appointment.paciente_id) || {} }
function appointmentStatus(appointment) { const status = String(appointment.estado || 'Pendiente').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (status.includes('atend')) return 'attended'; if (status.includes('no asist')) return 'no-show'; if (status.includes('cancel')) return 'cancelled'; if (status.includes('reprogram')) return 'rescheduled'; return 'pending' }
function appointmentStatusLabel(status) { return { pending: 'Pendiente', attended: 'Atendida', 'no-show': 'No asistió', rescheduled: 'Reprogramada', cancelled: 'Cancelada' }[status] || 'Pendiente' }
function renderAppointment(appointment) { const patient = appointmentPatient(appointment); const name = patient.nombre_completo || appointment.paciente_nombre || 'Paciente sin nombre'; const type = appointment.tipo_cita || appointment.tipo || 'Consulta'; const status = appointmentStatus(appointment); return `<div class="appointment-card" data-appointment-id="${escapeHtml(appointment.id)}" role="button" tabindex="0" aria-label="Editar cita de ${escapeHtml(name)}"><span class="appointment-time">${escapeHtml(appointment.hora_inicio || appointment.hora || '--:--')} ${appointment.hora_fin ? `- ${escapeHtml(appointment.hora_fin)}` : ''}</span><span class="patient-avatar">${initials(name)}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(patient.genero || 'Paciente')} · ${escapeHtml(age(patient.fecha_nacimiento))}</small></div><span class="appointment-type">${escapeHtml(type)}</span><span class="appointment-status ${status}">${appointmentStatusLabel(status)}</span></div>` }
function attachAppointmentHandlers() { $$('.appointment-card, .week-event').forEach((card) => { if (card.dataset.editBound) return; card.dataset.editBound = 'true'; const open = () => { const appointment = state.appointments.find((item) => String(item.id) === String(card.dataset.appointmentId)); console.debug('Clic en cita:', appointment); if (appointment) abrirModalEdicion(appointment) }; card.addEventListener('click', open); card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }) }) }
function renderGroup(id, appointments) { const target = $(`#${id}-list`); const heading = $(`[data-group="${id}"]`); const isCollapsed = appointments.length === 0; $(`#${id}-count`).textContent = `${appointments.length} ${appointments.length === 1 ? 'cita' : 'citas'}`; heading.classList.toggle('is-collapsed', isCollapsed); heading.setAttribute('aria-expanded', String(!isCollapsed)); target.innerHTML = appointments.length ? appointments.map(renderAppointment).join('') : '<div class="empty-state"><div><span class="empty-icon">▧</span><strong>No hay citas en este estado</strong></div></div>'; attachAppointmentHandlers() }
function renderDay() { const activeTypes = $$('.filter-section input:checked').map((input) => input.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')); const selectedDate = dateKey(state.selectedDate); const visible = state.appointments.filter((appointment) => String(appointment.fecha).slice(0, 10) === selectedDate && activeTypes.includes(String(appointment.tipo_cita || appointment.tipo || 'Consulta').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))); renderGroup('pending', visible.filter((appointment) => appointmentStatus(appointment) === 'pending')); renderGroup('attended', visible.filter((appointment) => appointmentStatus(appointment) === 'attended')); renderGroup('no-show', visible.filter((appointment) => appointmentStatus(appointment) === 'no-show')); renderGroup('closed', visible.filter((appointment) => ['cancelled', 'rescheduled'].includes(appointmentStatus(appointment)))) }
function renderMiniCalendar() { const date = state.selectedDate; const year = date.getFullYear(); const month = date.getMonth(); const firstDay = new Date(year, month, 1).getDay(); const offset = (firstDay + 6) % 7; const days = new Date(year, month + 1, 0).getDate(); const headings = ['L', 'M', 'X', 'J', 'V', 'S', 'D']; let html = `<div class="calendar-top"><button data-calendar-offset="-1" type="button">‹</button><span>${formatDate(date, { month: 'long', year: 'numeric' }).replace(/^./, (char) => char.toUpperCase())}</span><button data-calendar-offset="1" type="button">›</button></div><div class="calendar-grid">${headings.map((heading) => `<span>${heading}</span>`).join('')}`; for (let index = 0; index < offset; index++) html += '<span></span>'; for (let day = 1; day <= days; day++) { const selected = day === date.getDate(); html += `<span class="calendar-day ${selected ? 'is-selected' : ''}" data-calendar-day="${day}">${day}</span>` } $('.mini-calendar').innerHTML = html + '</div>'; $$('.calendar-day').forEach((button) => button.addEventListener('click', () => { state.selectedDate = new Date(year, month, Number(button.dataset.calendarDay)); updateDateHeader(); loadAppointments() })); $$('[data-calendar-offset]').forEach((button) => button.addEventListener('click', () => { state.selectedDate = new Date(year, month + Number(button.dataset.calendarOffset), 1); updateDateHeader(); loadAppointments() })) }
function renderWeek() {
	const monday = new Date(state.selectedDate)
	const day = monday.getDay()
	monday.setDate(monday.getDate() - ((day + 6) % 7))
	const hours = Array.from({ length: 10 }, (_, index) => index + 9)
	let html = '<div class="week-grid"><div class="week-head">Hora</div>'

	for (let index = 0; index < 7; index++) {
		const date = new Date(monday)
		date.setDate(monday.getDate() + index)
		html += `<div class="week-head">${formatDate(date, { weekday: 'short' }).replace('.', '')}<strong>${date.getDate()}</strong></div>`
	}

	for (const hour of hours) {
		html += `<div class="hour">${String(hour).padStart(2, '0')}:00</div>`
		for (let index = 0; index < 7; index++) {
			const date = new Date(monday)
			date.setDate(monday.getDate() + index)
			const fecha = dateKey(date)
			const hora = `${String(hour).padStart(2, '0')}:00`
			const idCeldaCalculada = `cell-${fecha}-${hora}`
			const events = state.appointments.filter((appointment) => String(appointment.fecha).slice(0, 10) === fecha && String(appointment.hora_inicio || '').slice(0, 5) === hora)
			console.log("3. Intentando renderizar cita en celda:", idCeldaCalculada)
			html += `<div id="${idCeldaCalculada}" data-date="${fecha}" data-hour="${hora}">${events.map((event) => `<div class="week-event" data-appointment-id="${escapeHtml(event.id)}" role="button" tabindex="0" aria-label="Editar cita de ${escapeHtml(appointmentPatient(event).nombre_completo || 'Cita')}">${escapeHtml(appointmentPatient(event).nombre_completo || 'Cita')}<br>${escapeHtml(event.tipo_cita || 'Consulta')}</div>`).join('')}</div>`
		}
	}

	$('.week-view').innerHTML = html + '</div>'
	attachAppointmentHandlers()
}
function renderPatientPicker() { const term = ($('#patient-search')?.value || '').toLowerCase().trim(); const patients = state.patients.filter((patient) => `${patient.nombre_completo || ''} ${patient.documento_identidad || ''}`.toLowerCase().includes(term)); $('#patient-picker').innerHTML = patients.length ? patients.map((patient) => `<button class="patient-option" data-patient-id="${escapeHtml(patient.id)}" type="button"><span class="patient-avatar">${initials(patient.nombre_completo)}</span><span><strong>${escapeHtml(patient.nombre_completo || 'Sin nombre')}</strong><small>${escapeHtml(patient.genero || 'Género no registrado')} · ${escapeHtml(age(patient.fecha_nacimiento))} · DNI ${escapeHtml(patient.documento_identidad || 'N/D')}</small></span></button>`).join('') : '<div class="empty-state"><div><strong>No encontramos pacientes</strong><span>Prueba con otro nombre o documento.</span></div></div>'; $$('.patient-option').forEach((button) => button.addEventListener('click', () => selectPatient(button.dataset.patientId))) }
function selectPatient(id) { state.selectedPatient = state.patients.find((patient) => String(patient.id) === String(id)); $('#patient-step').hidden = true; $('#datetime-step').hidden = false; $('[data-step-dot="1"]').classList.remove('is-current'); $('[data-step-dot="2"]').classList.add('is-current'); $('#selection-summary').innerHTML = `<span class="patient-avatar">${initials(state.selectedPatient.nombre_completo)}</span><strong>${escapeHtml(state.selectedPatient.nombre_completo)}</strong><span>con ${escapeHtml($('#doctor-select option:checked').textContent || 'el doctor')}</span>`; renderTimeSlots() }
function renderTimeSlots() { const slots = ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '18:00']; $('#time-slots').innerHTML = slots.map((slot) => `<button type="button" class="time-slot ${slot === state.selectedTime ? 'is-selected' : ''}" data-time="${slot}">${slot}</button>`).join(''); $$('.time-slot').forEach((button) => button.addEventListener('click', () => { state.selectedTime = button.dataset.time; renderTimeSlots() })) }
function configureDateLimits() { const today = todayKey(); $('#appointment-date').min = today; $('#edit-fecha').min = today; $('#fecha_nacimiento')?.setAttribute('max', today) }
function openModal() { $('#appointment-modal').hidden = false; $('#patient-step').hidden = false; $('#datetime-step').hidden = true; $('[data-step-dot="1"]').classList.add('is-current'); $('[data-step-dot="2"]').classList.remove('is-current'); $('#patient-search').value = ''; renderPatientPicker(); $('#appointment-date').min = todayKey(); $('#appointment-date').value = dateKey(state.selectedDate) < todayKey() ? todayKey() : dateKey(state.selectedDate) }
function closeModal() { $('#appointment-modal').hidden = true; state.selectedPatient = null }
async function saveAppointment() { if (!state.selectedPatient) { showToast('Selecciona un paciente para continuar'); return } const { data: { user }, error: authError } = await supabase.auth.getUser(); if (authError) { showToast(`No se pudo verificar la sesión: ${authError.message}`); return } if (!user) { window.location.href = '../ingresar.html'; return } const appointmentDate = $('#appointment-date').value; if (!appointmentDate || appointmentDate < todayKey()) { showToast('La fecha de la cita no puede ser anterior a hoy'); return } const [hours, minutes] = state.selectedTime.split(':').map(Number); const horaFin = `${String((hours + 1) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`; const doctorId = state.doctorId || state.doctors[0]?.id || null; const appointment = { paciente_id: state.selectedPatient.id, doctor_id: doctorId, fecha: appointmentDate, hora_inicio: `${state.selectedTime}:00`, hora_fin: horaFin, tipo_cita: $('#appointment-type').value, motivo: $('#appointment-reason').value.trim() || null, estado: 'Pendiente', registrado_por: user.id }; const { error } = await supabase.from('citas').insert(appointment); if (error) { console.error('Error al guardar la cita:', error); showToast(`No se pudo guardar la cita: ${error.message}`); return } showToast('Cita guardada correctamente'); closeModal(); state.selectedDate = new Date(`${appointment.fecha}T12:00:00`); updateDateHeader(); await loadAppointments() }
async function exportAppointments() { if (!await requireAuthenticatedUser('../ingresar.html')) return; const { data, error } = await supabase.from('citas').select('*, pacientes(*), profiles(*)').order('fecha').order('hora_inicio'); if (error) { showToast(`No se pudo exportar: ${error.message}`); return } const rows = (data || []).map((appointment) => { const patient = appointment.pacientes || {}; const doctor = appointment.profiles || state.doctors.find((item) => item.id === appointment.doctor_id) || {}; const registeredDate = appointment.created_at ? new Date(appointment.created_at) : null; return { Paciente: patient.nombre_completo || '', Edad: patient.fecha_nacimiento ? age(patient.fecha_nacimiento).replace(' años', '') : '', Sexo: patient.genero || '', 'Tipo documento': 'DNI', 'N° documento': patient.documento_identidad || '', Fecha: appointment.fecha || '', 'Hora inicio': appointment.hora_inicio || '', 'Hora fin': appointment.hora_fin || '', 'Tipo cita': appointment.tipo_cita || appointment.tipo || '', 'Doctor asignado': doctor.nombre_completo || doctor.full_name || doctor.email || '', Portal: appointment.portal || '', Motivo: appointment.motivo || '', Estado: appointment.estado || '', 'Concepto asociado': appointment.concepto_asociado || '', 'Registrado por': appointment.registrado_por || appointment.created_by || '', 'Fecha de registro': registeredDate ? dateKey(registeredDate) : '', 'Hora de registro': registeredDate ? registeredDate.toLocaleTimeString('es-ES') : '', 'Fecha y hora de registro': registeredDate ? registeredDate.toLocaleString('es-ES') : '' } }); const sheet = XLSX.utils.json_to_sheet(rows, { header: ['Paciente', 'Edad', 'Sexo', 'Tipo documento', 'N° documento', 'Fecha', 'Hora inicio', 'Hora fin', 'Tipo cita', 'Doctor asignado', 'Portal', 'Motivo', 'Estado', 'Concepto asociado', 'Registrado por', 'Fecha de registro', 'Hora de registro', 'Fecha y hora de registro'] }); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Citas'); XLSX.writeFile(workbook, 'Reporte_Citas.xlsx'); showToast('Reporte_Citas.xlsx descargado') }
function abrirModalEdicion(cita) { const paciente = appointmentPatient(cita); $('#edit-cita-id').value = cita.id; $('#edit-paciente-nombre').textContent = paciente.nombre_completo || 'Paciente sin nombre'; $('#edit-estado').value = cita.estado || 'Pendiente'; $('#edit-fecha').value = cita.fecha || ''; $('#edit-hora').value = (cita.hora_inicio || '').slice(0, 5); $('#edit-fecha').min = todayKey(); $('#modal-editar-cita').classList.remove('modal-oculto'); $('#modal-editar-cita').classList.add('modal-visible') }
function cerrarModalEdicion() { const modal = $('#modal-editar-cita'); modal.classList.remove('modal-visible'); modal.classList.add('modal-oculto') }
async function guardarEdicionCita(event) { event.preventDefault(); const { data: { user }, error: authError } = await supabase.auth.getUser(); if (authError) { showToast(`No se pudo verificar la sesión: ${authError.message}`); return } if (!user) { window.location.href = '../ingresar.html'; return } const citaId = $('#edit-cita-id').value; const citaActual = state.appointments.find((appointment) => String(appointment.id) === String(citaId)); const nuevoEstado = $('#edit-estado').value; const nuevaFecha = $('#edit-fecha').value; const nuevaHora = $('#edit-hora').value; if (!citaActual) { showToast('No se encontró la cita seleccionada'); return } if (!nuevaFecha || !nuevaHora) { showToast('Completa la nueva fecha y hora'); return }

	if (nuevoEstado === 'Reprogramada') {
		// UPDATE: conserva la cita original como registro histórico con estado Reprogramada.
		const { error: updateError } = await supabase.from('citas').update({ estado: 'Reprogramada' }).eq('id', citaId)
		if (updateError) { console.error('Error al marcar la cita como reprogramada:', updateError); alert(`No se pudo actualizar la cita original: ${updateError.message}`); return }

		// INSERT: crea la nueva cita en la fecha elegida y comienza como Pendiente.
		const { error: insertError } = await supabase.from('citas').insert({ paciente_id: citaActual.paciente_id, doctor_id: citaActual.doctor_id || null, fecha: nuevaFecha, hora_inicio: nuevaHora, tipo_cita: citaActual.tipo_cita || citaActual.tipo || 'Consulta', motivo: citaActual.motivo || null, estado: 'Pendiente', registrado_por: user.id })
		if (insertError) { console.error('Error al crear la cita reprogramada:', insertError); alert(`La cita original quedó marcada como reprogramada, pero no se pudo crear la nueva: ${insertError.message}`); return }
	} else {
		const { error } = await supabase.from('citas').update({ estado: nuevoEstado, fecha: nuevaFecha, hora_inicio: nuevaHora }).eq('id', citaId)
		if (error) { console.error('Error al actualizar la cita:', error); alert(`No se pudo actualizar la cita: ${error.message}`); return }
	}

	cerrarModalEdicion(); state.selectedDate = new Date(`${nuevaFecha}T12:00:00`); updateDateHeader(); await loadAppointments(); showToast(nuevoEstado === 'Reprogramada' ? 'Cita reprogramada correctamente' : 'Cita actualizada correctamente') }
function bindEditEvents() { $('#btn-cerrar-edicion').addEventListener('click', cerrarModalEdicion); $('#form-editar-cita').addEventListener('submit', guardarEdicionCita); $('#modal-editar-cita').addEventListener('click', (event) => { if (event.target.id === 'modal-editar-cita') cerrarModalEdicion() }); $('.appointments-panel').addEventListener('click', (event) => { const card = event.target.closest('.appointment-card, .week-event'); if (!card) return; const cita = state.appointments.find((item) => String(item.id) === String(card.dataset.appointmentId)); console.debug('Clic delegado en cita:', cita); if (cita) abrirModalEdicion(cita) }) }

async function descargarReporteExcel() {
	if (!await requireAuthenticatedUser('../ingresar.html')) return
	const { data: citas, error } = await supabase
		.from('citas')
		.select(`
			*,
			pacientes ( nombre_completo, genero, fecha_nacimiento, documento_identidad ),
			doctor:profiles!citas_doctor_id_fkey ( full_name ),
			registrador:profiles!citas_registrado_por_fkey ( full_name )
		`)

	if (error) {
		alert('Error al consultar datos para el reporte: ' + error.message)
		return
	}

	const reporteFormateado = (citas || []).map((cita) => {
		const fechaRegistro = new Date(cita.created_at)
		return {
			'Paciente': cita.pacientes?.nombre_completo || '',
			'Edad': calcularEdad(cita.pacientes?.fecha_nacimiento),
			'Sexo': cita.pacientes?.genero || '',
			'Tipo documento': 'DNI',
			'N° documento': cita.pacientes?.documento_identidad || '',
			'Fecha': cita.fecha || '',
			'Hora inicio': cita.hora_inicio || '',
			'Hora fin': cita.hora_fin || '',
			'Tipo cita': cita.tipo_cita || '',
			'Doctor asignado': cita.doctor?.full_name || 'Sin asignar',
			'Portal': cita.portal || 'Recepción',
			'Motivo': cita.motivo || '',
			'Estado': cita.estado || '',
			'Concepto asociado': cita.concepto_asociado || '',
			'Registrado por': cita.registrador?.full_name || '',
			'Fecha de registro': Number.isNaN(fechaRegistro.getTime()) ? '' : fechaRegistro.toISOString().split('T')[0],
			'Hora de registro': Number.isNaN(fechaRegistro.getTime()) ? '' : fechaRegistro.toTimeString().split(' ')[0],
			'Fecha y hora de registro': Number.isNaN(fechaRegistro.getTime()) ? '' : fechaRegistro.toLocaleString()
		}
	})

	const hoja = XLSX.utils.json_to_sheet(reporteFormateado)
	const libro = XLSX.utils.book_new()
	XLSX.utils.book_append_sheet(libro, hoja, 'Citas')
	XLSX.writeFile(libro, `Reporte_Citas_${new Date().toISOString().split('T')[0]}.xlsx`)
}

function calcularEdad(fechaNacimiento) {
	if (!fechaNacimiento) return ''
	const hoy = new Date()
	const cumple = new Date(fechaNacimiento)
	let edadCalculada = hoy.getFullYear() - cumple.getFullYear()
	const diferenciaMes = hoy.getMonth() - cumple.getMonth()
	if (diferenciaMes < 0 || (diferenciaMes === 0 && hoy.getDate() < cumple.getDate())) edadCalculada--
	return edadCalculada
}

function bindEvents() { $('#previous-date').addEventListener('click', () => changeDate(-1)); $('#next-date').addEventListener('click', () => changeDate(1)); $('#today-button').addEventListener('click', () => { state.selectedDate = new Date(); updateDateHeader(); loadAppointments() }); $('#date-picker').addEventListener('change', (event) => { state.selectedDate = new Date(`${event.target.value}T12:00:00`); updateDateHeader(); loadAppointments() }); $('#view-select').addEventListener('change', (event) => { state.view = event.target.value; $('#day-view').hidden = state.view !== 'day'; $('#week-view').hidden = state.view !== 'week' }); $('#doctor-select').addEventListener('change', (event) => { state.doctorId = event.target.value; $('#sidebar-doctor').value = state.doctorId; loadAppointments() }); $('#sidebar-doctor').addEventListener('change', (event) => { $('#doctor-select').value = event.target.value; state.doctorId = event.target.value; loadAppointments() }); $('#new-appointment-button').addEventListener('click', openModal); $('#close-modal').addEventListener('click', closeModal); $('#back-to-patient').addEventListener('click', () => { $('#datetime-step').hidden = true; $('#patient-step').hidden = false; $('[data-step-dot="2"]').classList.remove('is-current'); $('[data-step-dot="1"]').classList.add('is-current') }); $('#save-appointment').addEventListener('click', saveAppointment); $('#patient-search').addEventListener('input', renderPatientPicker); $('#export-button').addEventListener('click', exportAppointments); $('#sidebar-logout').addEventListener('click', logout); $$('.group-heading').forEach((button) => button.addEventListener('click', () => { const collapsed = button.classList.toggle('is-collapsed'); button.setAttribute('aria-expanded', String(!collapsed)) })); $$('.filter-section input').forEach((input) => input.addEventListener('change', renderDay)) }
async function init() { const user = await requireAuthenticatedUser('../ingresar.html'); if (!user) return; state.selectedDate = new Date(); configureDateLimits(); updateDateHeader(); bindEvents(); bindEditEvents(); const exportButton = $('#export-button'); exportButton.replaceWith(exportButton.cloneNode(true)); $('#export-button').addEventListener('click', descargarReporteExcel); $('#view-select').addEventListener('change', loadAppointments); await Promise.all([loadDoctors(), loadPatients()]); await loadAppointments() }
init()
