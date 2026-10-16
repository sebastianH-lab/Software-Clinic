import { supabase } from './supabase.js'

const formLogin = document.getElementById('form-login')

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
