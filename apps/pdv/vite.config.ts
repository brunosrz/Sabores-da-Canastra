import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react(), cloudflare({ viteEnvironment: { name: 'worker' } })],
	environments: {
		worker: { build: { sourcemap: true } },
	},
});
