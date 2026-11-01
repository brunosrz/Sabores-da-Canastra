import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { healthResponse } from '../health';

export const Route = createFileRoute('/api/health')({
	server: {
		handlers: {
			GET: () => healthResponse('pdv', env.API),
		},
	},
});
