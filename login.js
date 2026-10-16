import { supabase } from './supabase.js'

const formLogin = document.getElementById('form-login')

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
	button.addEventListener('click', () => {
		const input = document.getElementById(button.getAttribute('aria-controls'))
		if (!input) return
		const showing = input.type === 'password'
		input.type = showing ? 'text' : 'password'
		button.setAttribute('aria-pressed', String(showing))
		button.setAttribute('aria-label', showing ? 'Ocultar contraseña' : 'Mostrar contraseña')
	})
})

formLogin.addEventListener('submit', async (event) => {
	event.preventDefault()

	const email = document.getElementById('email').value
	const password = document.getElementById('password').value

	const { error } = await supabase.auth.signInWithPassword({
		email,
		password,
	})

	if (error) {
		alert('Credenciales incorrectas o correo no confirmado.')
		return
	}

	alert('¡Bienvenido a tu software clínico!')
	window.location.href = 'pacientes.html'
})
