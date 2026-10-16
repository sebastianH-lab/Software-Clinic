import { supabase } from './supabase.js'

const formRegistro = document.getElementById('form-registro')
const password = document.getElementById('password')
const confirmPassword = document.getElementById('confirm-password')

const validatePasswords = () => {
	confirmPassword.setCustomValidity(
		password.value === confirmPassword.value ? '' : 'Las contraseñas no coinciden.'
	)
}

password.addEventListener('input', validatePasswords)
confirmPassword.addEventListener('input', validatePasswords)

formRegistro.addEventListener('submit', async (event) => {
	event.preventDefault()
	validatePasswords()

	if (!formRegistro.checkValidity()) {
		formRegistro.reportValidity()
		return
	}

	const email = document.getElementById('email').value
	const name = document.getElementById('name').value.trim()
	const countryCode = document.getElementById('country-code').value
	const phone = document.getElementById('phone').value.trim()
	const passwordValue = password.value
	const { error } = await supabase.auth.signUp({
		email,
		password: passwordValue,
		options: {
			data: {
				full_name: name,
				phone: `${countryCode}${phone}`,
			},
		},
	})

	if (error) {
		alert('Hubo un error: ' + error.message)
		return
	}

	alert('¡Registro exitoso! Revisa tu correo electrónico para confirmar la cuenta.')
	
	// Limpiar el formulario
	formRegistro.reset()
	
	// Redirigir a inicio de sesión después de 1.5 segundos
	setTimeout(() => {
		window.location.href = 'ingresar.html'
	}, 1500)
})
