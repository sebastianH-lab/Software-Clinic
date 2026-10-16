import { clearClientStorage, requireAuthenticatedUser, supabase } from './supabase.js'

const user = await requireAuthenticatedUser('../ingresar.html')
if (user) {
	const search = document.querySelector('#faq-search')
	const faqItems = [...document.querySelectorAll('[data-faq]')]
	const faqGroups = [...document.querySelectorAll('.faq-group')]
	const emptyMessage = document.querySelector('#faq-empty')

	function filterFaqs() {
		const query = search.value.trim().toLocaleLowerCase()
		let visibleCount = 0
		faqItems.forEach((item) => {
			const matches = item.textContent.toLocaleLowerCase().includes(query)
			item.hidden = !matches
			if (!matches) item.open = false
			if (matches) visibleCount++
		})
		faqGroups.forEach((group) => {
			group.hidden = !group.querySelector('[data-faq]:not([hidden])')
		})
		emptyMessage.hidden = visibleCount > 0
	}

	search.addEventListener('input', filterFaqs)

	const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Usuario'
	document.querySelector('#sidebar-name').textContent = name
	document.querySelector('#sidebar-avatar').textContent = name.trim().charAt(0).toUpperCase()

	document.querySelector('#sidebar-logout').addEventListener('click', async () => {
		const { error } = await supabase.auth.signOut()
		if (error) {
			console.error('No se pudo cerrar la sesión:', error)
			return
		}
		clearClientStorage()
		window.location.href = '../ingresar.html'
	})
}
