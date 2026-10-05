import { expect, test } from '@playwright/test';

test('security headers are present on server-rendered pages', async ({ request }) => {
	const response = await request.get('/login');
	expect(response.ok()).toBe(true);

	const headers = response.headers();
	const csp = headers['content-security-policy'] ?? '';
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain('nonce-');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('no-referrer');
	expect(headers['x-frame-options']).toBe('DENY');
});
