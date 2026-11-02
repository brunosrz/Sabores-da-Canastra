import { describe, expect, it } from 'vitest';
import { healthResponse } from '../src/health';

describe('endpoint de saúde do PDV', () => {
	it('retorna o estado do backend e o nome do aplicativo em JSON', async () => {
		const api = {
			fetch: async () => Response.json({ status: 'ok' }),
		};
		const response = await healthResponse('pdv', api);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ status: 'ok', app: 'pdv', backend: 'ok' });
	});

	it('informa indisponibilidade do backend', async () => {
		const api = {
			fetch: async () => {
				throw new Error('indisponível');
			},
		};
		const response = await healthResponse('pdv', api);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ status: 'degraded', app: 'pdv', backend: 'unavailable' });
	});
});
