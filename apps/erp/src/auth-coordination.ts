/** Same-origin Web Locks, also used by the PDV sync queue, serialize cookie mutations across tabs. */
export function withAuthMutation<T>(work: () => Promise<T>): Promise<T> {
	if (typeof navigator === 'undefined' || !navigator.locks) {
		return Promise.reject(new Error('Este navegador não oferece coordenação segura de sessão entre abas.'));
	}
	return navigator.locks.request('sabores-auth-session', work);
}
