import { SELF, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src';
import { resolveAppMode } from '../src/ui/app-mode';

describe('Hono Worker API', () => {
	it('responde à verificação de saúde no Worker real', async () => {
		const response = await SELF.fetch('http://example.com/api/health');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: 'ok',
			service: 'sabores-da-canastra',
		});
	});

	it('responde com JSON no teste unitário do Worker', async () => {
		const request = new Request('http://example.com/api/health');
		const context = createExecutionContext();
		const response = await worker.fetch(request, env, context);
		await waitOnExecutionContext(context);

		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.status).toBe(200);
	});

	it('retorna 404 para uma rota de API inexistente', async () => {
		const response = await SELF.fetch('http://example.com/api/rota-inexistente');

		expect(response.status).toBe(404);
	});
});

describe('separação das experiências', () => {
	it('resolve PDV e Gestão pelos hosts e caminhos locais', () => {
		expect(resolveAppMode('pdv.brunosrz.com', '/')).toBe('pdv');
		expect(resolveAppMode('gestao.brunosrz.com', '/')).toBe('gestao');
		expect(resolveAppMode('localhost', '/pdv')).toBe('pdv');
		expect(resolveAppMode('localhost', '/gestao')).toBe('gestao');
		expect(resolveAppMode('localhost', '/')).toBe('inicio');
	});
});
