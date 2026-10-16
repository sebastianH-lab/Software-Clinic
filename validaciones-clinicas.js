const EDAD_MINIMA = 5
const ESTATURA_MINIMA = 0.9
const ESTATURA_MAXIMA = 2.3
const PESO_MINIMO = 12
const PESO_MAXIMO = 250

function fechaLocalComoClave(fecha) {
	const anio = fecha.getFullYear()
	const mes = String(fecha.getMonth() + 1).padStart(2, '0')
	const dia = String(fecha.getDate()).padStart(2, '0')
	return `${anio}-${mes}-${dia}`
}

export function obtenerFechaMaximaNacimiento(fechaActual = new Date()) {
	const anio = fechaActual.getFullYear() - EDAD_MINIMA
	const mes = fechaActual.getMonth()
	const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate()
	const dia = Math.min(fechaActual.getDate(), ultimoDiaMes)
	return fechaLocalComoClave(new Date(anio, mes, dia))
}

function calcularEdad(fechaNacimiento, fechaActual = new Date()) {
	const [anio, mes, dia] = fechaNacimiento.split('-').map(Number)
	const nacimiento = new Date(anio, mes - 1, dia)
	let edad = fechaActual.getFullYear() - anio
	if (
		fechaActual.getMonth() < mes - 1
		|| (fechaActual.getMonth() === mes - 1 && fechaActual.getDate() < dia)
	) {
		edad--
	}
	return { edad, nacimiento }
}

export function validarDatosClinicosPaciente(datos, fechaActual = new Date()) {
	const fechaNacimiento = datos.fecha_nacimiento
	if (fechaNacimiento) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) {
			return 'Ingrese una fecha de nacimiento válida.'
		}
		const { edad, nacimiento } = calcularEdad(fechaNacimiento, fechaActual)
		if (
			Number.isNaN(nacimiento.getTime())
			|| fechaLocalComoClave(nacimiento) !== fechaNacimiento
			|| nacimiento > fechaActual
		) {
			return 'Ingrese una fecha de nacimiento válida.'
		}
		if (edad < EDAD_MINIMA) {
			return 'La edad mínima permitida para el registro de pacientes es de 5 años.'
		}
	}

	const estatura = datos.estatura === '' || datos.estatura === null || datos.estatura === undefined
		? null
		: Number(datos.estatura)
	if (estatura !== null && (!Number.isFinite(estatura) || estatura < ESTATURA_MINIMA || estatura > ESTATURA_MAXIMA)) {
		return 'Por favor, ingrese una estatura válida (entre 0.90 m y 2.30 m).'
	}

	const peso = datos.peso === '' || datos.peso === null || datos.peso === undefined
		? null
		: Number(datos.peso)
	if (peso !== null && (!Number.isFinite(peso) || peso < PESO_MINIMO)) {
		return `El peso ingresado (${datos.peso} kg) no es válido para pacientes de 5 años o más. Ingrese un peso dentro del rango real (mínimo 12 kg).`
	}
	if (peso !== null && peso > PESO_MAXIMO) {
		return 'Por favor, ingrese un peso válido (entre 12 kg y 250 kg).'
	}

	if (peso !== null && estatura !== null) {
		const imc = peso / (estatura ** 2)
		if (imc < 10 || imc > 70) {
			return 'El peso y la estatura ingresados generan un IMC extremo (menor a 10 o mayor a 70). Verifique las medidas antes de continuar.'
		}
	}

	return null
}
