import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'bun run build && bun run preview', port: 4173, reuseExistingServer: true },
	testMatch: ['**/*.e2e.{ts,js}', 'tests/e2e/**/*.spec.ts'],
	use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173' }
});
