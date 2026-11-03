import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { devtools } from '@tanstack/devtools-vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		paraglideVitePlugin({
			outputStructure: 'message-modules',
			project: fileURLToPath(new URL('../../packages/i18n/project.inlang', import.meta.url)),
			outdir: fileURLToPath(new URL('../../packages/i18n/src/paraglide', import.meta.url)),
		}),
		devtools(),
		cloudflare({ viteEnvironment: { name: 'ssr' } }),
		tanstackStart({ spa: { enabled: true } }),
		react(),
		tailwindcss(),
	],
});
