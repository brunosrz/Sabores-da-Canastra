import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';

const csrfMiddleware = createCsrfMiddleware({
	filter: (context) => context.handlerType === 'serverFn',
});

const searchPrivacyMiddleware = createMiddleware({ type: 'request' }).server(async ({ next }) => {
	const result = await next();
	result.response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
	return result;
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, searchPrivacyMiddleware],
}));
