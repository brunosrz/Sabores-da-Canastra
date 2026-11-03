import handler from '@tanstack/react-start/server-entry';
import { paraglideMiddleware } from '@sabores/i18n/server';

export default {
	fetch(request: Request): Promise<Response> {
		return paraglideMiddleware(request, ({ request: localizedRequest }) => handler.fetch(localizedRequest));
	},
};
