export type AppMode = 'pdv' | 'gestao' | 'inicio';

export function resolveAppMode(hostname: string, pathname: string): AppMode {
	const normalizedHost = hostname.toLowerCase();

	if (normalizedHost.startsWith('pdv.') || pathname.startsWith('/pdv')) {
		return 'pdv';
	}

	if (normalizedHost.startsWith('gestao.') || pathname.startsWith('/gestao')) {
		return 'gestao';
	}

	return 'inicio';
}
