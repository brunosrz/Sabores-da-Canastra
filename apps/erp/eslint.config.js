import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist/**', 'node_modules/**', 'worker-configuration.d.ts'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx,js,mjs}'],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		plugins: { 'react-hooks': reactHooks },
		rules: reactHooks.configs.flat.recommended.rules,
	},
);
