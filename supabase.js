// Importamos Supabase directamente desde su servidor de distribución (CDN)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const supabaseUrl = 'https://nnxteiprjsirlgvpbcdd.supabase.co'
const supabaseKey = 'sb_publishable_qEm1krhlH_b-uI2obRLOrA_bVe22W3c'

// Exportamos la conexión para usarla en el resto de tu proyecto
export const supabase = createClient(supabaseUrl, supabaseKey)

export async function requireAuthenticatedUser(loginPath = 'ingresar.html') {
	const { data: { user }, error } = await supabase.auth.getUser()
	if (error) {
		if (error.name === 'AuthSessionMissingError' || error.code === 'session_not_found') {
			window.location.href = loginPath
			return null
		}
		throw error
	}
	if (!user) {
		window.location.href = loginPath
		return null
	}
	return user
}

export function clearClientStorage() {
	localStorage.clear()
	sessionStorage.clear()
}
