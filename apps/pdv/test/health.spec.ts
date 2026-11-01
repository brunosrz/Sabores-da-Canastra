import { describe, expect, it } from 'vitest';
import { healthResponse } from '../src/health';

describe('endpoint de saúde do PDV', () => {
	it('retorna estado e nome do aplicativo em JSON', async () => {
		const response = healthResponse('pdv');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ status: 'ok', app: 'pdv' });
	});
});
