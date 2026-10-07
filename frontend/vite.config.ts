import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

const apiTarget = process.env.CIRCUITGATE_API_PROXY_TARGET ?? 'http://localhost:8080';

const apiProxy = {
	'/api': {
		target: apiTarget,
		changeOrigin: true
	},
	'/ws': {
		target: apiTarget.replace(/^http/, 'ws'),
		ws: true,
		changeOrigin: true
	}
};

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					// WebAssembly.instantiate needs wasm-unsafe-eval; never unsafe-eval.
					'script-src': ['self', 'wasm-unsafe-eval'],
					// Dynamic inline styles position progress and probe annotations;
					// Svelte CSP hashes cannot cover attribute bindings.
					'style-src': ['self', 'unsafe-inline'],
					'base-uri': ['self'],
					'object-src': ['none'],
					'frame-ancestors': ['none'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self', 'ws:', 'wss:']
				}
			},
			adapter: adapter()
		})
	],
	server: { proxy: apiProxy },
	preview: { proxy: apiProxy },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
