import { requireAuthenticatedUser, supabase } from './supabase.js'
import { validarDatosClinicosPaciente } from './validaciones-clinicas.js'

// ==================== CONTAR PACIENTES REGISTRADOS ====================
export async function contarPacientes() {
	if (!await requireAuthenticatedUser()) return null
	const { count, error } = await supabase
		.from('pacientes')
		.select('*', { count: 'exact', head: true })

	if (error) {
		console.error('Error al contar pacientes:', error.message)
		return 0
	}

	return count || 0
}

// ==================== ACTUALIZAR CONTADOR EN LA UI ====================
export async function actualizarContadorPacientes() {
	const totalPacientes = await contarPacientes()
	const contadorEl = document.getElementById('patient-count')
	
	if (contadorEl) {
		const texto = totalPacientes === 1 ? '1 registro' : `${totalPacientes} registros`
		contadorEl.textContent = texto
	}

	return totalPacientes
}

// ==================== REGISTRAR NUEVO PACIENTE ====================
export async function registrarPaciente(datosFormulario) {
	const validationError = validarDatosClinicosPaciente(datosFormulario)
	if (validationError) return { success: false, error: validationError }

	const { data: { user }, error: authError } = await supabase.auth.getUser()
	if (authError) {
		console.error('Error al verificar la sesión:', authError.message)
		return { success: false, error: authError.message }
	}
	if (!user) {
		window.location.href = 'ingresar.html'
		return { success: false, error: 'No hay una sesión activa' }
	}

	const { data, error } = await supabase
		.from('pacientes')
		.insert([
			{
				nombre_completo: datosFormulario.nombre_completo,
				genero: datosFormulario.genero || null,
				documento_identidad: datosFormulario.documento_identidad || null,
				fecha_nacimiento: datosFormulario.fecha_nacimiento || null,
				telefono: datosFormulario.telefono || null,
				correo: datosFormulario.correo || null,
				peso: datosFormulario.peso || null,
				estatura: datosFormulario.estatura || null,
				imc: datosFormulario.imc || null,
				porcentaje_grasa: datosFormulario.porcentaje_grasa || null,
				temperatura: datosFormulario.temperatura || null,
				saturacion_oxigeno: datosFormulario.saturacion_oxigeno || null,
				frecuencia_respiratoria: datosFormulario.frecuencia_respiratoria || null,
				frecuencia_cardiaca: datosFormulario.frecuencia_cardiaca || null,
				presion_arterial: datosFormulario.presion_arterial || null,
				antecedentes_patologicos: datosFormulario.antecedentes_patologicos || [],
				antecedentes_oftalmologicos: datosFormulario.antecedentes_oftalmologicos || [],
				antecedentes_quirurgicos: datosFormulario.antecedentes_quirurgicos || [],
				alergias: datosFormulario.alergias || [],
				medicacion_habitual: datosFormulario.medicacion_habitual || [],
				notas_adicionales: datosFormulario.notas_adicionales || null,
				registrado_por: user.id
			}
		])
		.select()

	if (error) {
		console.error('Error al guardar el paciente:', error.message)
		return { success: false, error: error.message }
	} else {
		console.log('Paciente registrado con éxito. ID generado:', data[0].id)
		return { success: true, data: data[0] }
	}
}

// ==================== CARGAR PACIENTE DESDE SUPABASE ====================
export async function cargarPaciente(pacienteId) {
	if (!await requireAuthenticatedUser()) return { success: false, error: 'No hay una sesión activa' }
	// Validar si tenemos un ID
	if (!pacienteId) {
		console.error('No se especificó ningún ID de paciente.')
		return { success: false, error: 'ID no proporcionado' }
	}

	// Consulta a Supabase
	const { data: paciente, error } = await supabase
		.from('pacientes')
		.select('*')
		.eq('id', pacienteId)
		.single()

	if (error) {
		console.error('Error al traer los datos del paciente:', error.message)
		return { success: false, error: error.message }
	}

	return { success: true, data: paciente }
}

// ==================== ACTUALIZAR INFORMACIÓN DEL PACIENTE EN EL DOM ====================
export function mostrarPacienteEnPantalla(paciente) {
	try {
		// Datos básicos
		const nombreEl = document.getElementById('patient-name-1')
		if (nombreEl) nombreEl.textContent = paciente.nombre_completo || 'Sin Nombre'

		// Avatar con iniciales
		const avatarEl = document.getElementById('patient-avatar-1')
		if (avatarEl) {
			const iniciales = paciente.nombre_completo
				?.split(' ')
				.slice(0, 2)
				.map(n => n.charAt(0).toUpperCase())
				.join('') || '?'
			avatarEl.textContent = iniciales
		}

		// DNI
		const dniEl = document.getElementById('patient-dni-1')
		if (dniEl) dniEl.textContent = `DNI ${paciente.documento_identidad || 'No especificado'}`

		// Edad calculada desde fecha de nacimiento
		if (paciente.fecha_nacimiento) {
			const edad = calcularEdad(paciente.fecha_nacimiento)
			const edadEl = document.getElementById('patient-edad-1')
			if (edadEl) edadEl.textContent = `${edad} años`
		}

		// Última visita
		const ultimaVisitaEl = document.getElementById('patient-ultima-visita-1')
		if (ultimaVisitaEl) {
			const ultima = paciente.ultima_visita 
				? formatearFecha(paciente.ultima_visita)
				: 'Sin registro'
			ultimaVisitaEl.textContent = `Última visita: ${ultima}`
		}

		// Actualizar link a historia clínica
		const linkEl = document.querySelector('a[href*="historia-clinica.html"]')
		if (linkEl && paciente.id) {
			linkEl.href = `sub/historia-clinica.html?id=${paciente.id}`
		}

		console.log('Paciente mostrado en pantalla:', paciente.nombre_completo)
	} catch (error) {
		console.error('Error al mostrar paciente en pantalla:', error.message)
	}
}

// ==================== FUNCIONES AUXILIARES ====================

// Calcular edad desde fecha de nacimiento
function calcularEdad(fechaNacimiento) {
	const hoy = new Date()
	const nacimiento = new Date(fechaNacimiento)
	let edad = hoy.getFullYear() - nacimiento.getFullYear()
	const diferenciaMes = hoy.getMonth() - nacimiento.getMonth()

	if (diferenciaMes < 0 || (diferenciaMes === 0 && hoy.getDate() < nacimiento.getDate())) {
		edad--
	}

	return edad
}

// Formatear fecha a formato legible
function formatearFecha(fecha) {
	const opciones = { year: 'numeric', month: 'short', day: 'numeric' }
	return new Date(fecha).toLocaleDateString('es-ES', opciones)
}

// ==================== CARGAR PACIENTE AL ABRIR LA PÁGINA ====================
export async function inicializarPaginaPacientes() {
	// Obtener el ID del paciente desde la URL (si existe)
	const urlParams = new URLSearchParams(window.location.search)
	const pacienteId = urlParams.get('id')

	if (pacienteId) {
		// Si viene un ID en la URL, cargar ese paciente
		const resultado = await cargarPaciente(pacienteId)
		if (resultado.success) {
			mostrarPacienteEnPantalla(resultado.data)
		} else {
			console.error('No se pudo cargar el paciente:', resultado.error)
		}
	} else {
		// Si no hay ID, cargar el primer paciente por defecto
		const resultado = await cargarPrimerPaciente()
		if (resultado.success) {
			mostrarPacienteEnPantalla(resultado.data)
		}
	}
}


// Cargar el primer paciente registrado
async function cargarPrimerPaciente() {
	if (!await requireAuthenticatedUser()) return { success: false, error: 'No hay una sesión activa' }
	const { data, error } = await supabase
		.from('pacientes')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(1)
		.single()

	if (error) {
		console.error('Error al cargar el primer paciente:', error.message)
		return { success: false, error: error.message }
	}

	return { success: true, data }
    
}