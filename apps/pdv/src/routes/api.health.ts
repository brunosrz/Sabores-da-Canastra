import { createFileRoute } from '@tanstack/react-router';
import { healthResponse } from '../health';

export const Route = createFileRoute('/api/health')({
	server: {
		handlers: {
			GET: () => healthResponse('pdv'),
		},
	},
});
