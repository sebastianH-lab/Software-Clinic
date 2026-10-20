const sidebar = document.querySelector('.sidebar, .agenda-sidebar')
const shell = document.querySelector('.dashboard-shell, .agenda-shell')

if (sidebar && shell) {
	sidebar.inert = window.innerWidth <= 768
	const brand = sidebar.querySelector('.agenda-brand, .brand')
	const mobileHeader = document.createElement('header')
	mobileHeader.className = 'mobile-app-header'

	if (brand) {
		const mobileBrand = brand.cloneNode(true)
		mobileBrand.classList.add('mobile-app-brand')
		mobileHeader.appendChild(mobileBrand)
	}

	const menuToggle = document.createElement('button')
	menuToggle.className = 'mobile-sidebar-toggle'
	menuToggle.type = 'button'
	menuToggle.setAttribute('aria-label', 'Abrir menú de navegación')
	menuToggle.setAttribute('aria-expanded', 'false')
	menuToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>'
	mobileHeader.appendChild(menuToggle)
	document.body.insertBefore(mobileHeader, shell)

	const overlay = document.createElement('button')
	overlay.className = 'mobile-nav-overlay'
	overlay.type = 'button'
	overlay.setAttribute('aria-label', 'Cerrar menú de navegación')
	overlay.hidden = true
	document.body.appendChild(overlay)

	const closeButton = document.createElement('button')
	closeButton.className = 'mobile-sidebar-close'
	closeButton.type = 'button'
	closeButton.setAttribute('aria-label', 'Cerrar menú de navegación')
	closeButton.textContent = '×'
	if (brand) brand.insertAdjacentElement('afterend', closeButton)

	const closeMenu = (returnFocus = false) => {
		sidebar.classList.remove('active')
		overlay.hidden = true
		sidebar.inert = window.innerWidth <= 768
		menuToggle.setAttribute('aria-expanded', 'false')
		menuToggle.setAttribute('aria-label', 'Abrir menú de navegación')
		document.body.classList.remove('mobile-nav-open')
		if (returnFocus) menuToggle.focus()
	}

	menuToggle.addEventListener('click', () => {
		const isOpen = sidebar.classList.toggle('active')
		overlay.hidden = !isOpen
		sidebar.inert = !isOpen && window.innerWidth <= 768
		menuToggle.setAttribute('aria-expanded', String(isOpen))
		menuToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación')
		document.body.classList.toggle('mobile-nav-open', isOpen)
		if (isOpen) closeButton.focus()
	})

	closeButton.addEventListener('click', () => closeMenu(true))
	overlay.addEventListener('click', () => closeMenu(true))
	sidebar.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => closeMenu()))
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && sidebar.classList.contains('active')) closeMenu(true)
	})
	window.addEventListener('resize', () => {
		if (window.innerWidth > 768) {
			sidebar.inert = false
			if (sidebar.classList.contains('active')) closeMenu()
		} else if (!sidebar.classList.contains('active')) {
			sidebar.inert = true
		}
	})
}
