import { defineConfig } from '@playwright/test';

export default defineConfig({
	// One worker: the suite shares a backend and database, and the
	// performance spec measures toggle latency, so parallel browsers would
	// contend for the same CPU and make the numbers meaningless.
	workers: 1,
	webServer: { command: 'bun run build && bun run preview', port: 4173, reuseExistingServer: true },
	testMatch: ['**/*.e2e.{ts,js}', 'tests/e2e/**/*.spec.ts'],
	use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173' }
});
