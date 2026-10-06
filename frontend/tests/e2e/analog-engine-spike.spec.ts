import { expect, test } from '@playwright/test';

const DIVIDER = `* U1 browser spike: resistive divider
V1 1 0 DC 12
R1 1 2 10k
R2 2 0 10k
.op
.end
`;

// Long enough that the solver cannot finish before the terminate below; used
// only to exercise cancel = worker terminate-and-respawn.
const LONG_TRAN = `* U1 cancel proof: long transient
V1 1 0 PULSE(0 1 0 1n 1n 10 20)
R1 1 2 1k
C1 2 0 10u
.tran 1u 1
.end
`;

test('analog engine runs in a module worker under the production CSP', async ({ page, request }) => {
	const response = await request.get('/login');
	expect(response.ok()).toBe(true);
	const csp = response.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("'wasm-unsafe-eval'");
	expect(csp).not.toContain("'unsafe-eval'");

	await page.goto('/analog-spike');
	await expect(page.getByTestId('analog-spike-status')).toHaveText('ok', { timeout: 15_000 });
	console.log(`[U1 browser measurements] ${await page.getByTestId('analog-spike-detail').textContent()}`);

	const midpoint = await page.evaluate(() => {
		const spike = (window as unknown as { __analogSpike: { divider: { plot: { variables: Array<{ name: string; values: Array<number | { re: number }> }> } | null } | null } }).__analogSpike;
		const variable = spike.divider?.plot?.variables.find((candidate) => candidate.name === 'v(2)');
		const value = variable?.values[0];
		return typeof value === 'number' ? value : null;
	});
	expect(midpoint).not.toBeNull();
	expect(Math.abs((midpoint as number) - 6.0)).toBeLessThanOrEqual(0.06);

	const wasmUrl = await page.evaluate(
		() =>
			(window as unknown as { __analogSpike: { divider: { wasmUrl: string } | null } }).__analogSpike
				.divider?.wasmUrl ?? ''
	);
	expect(wasmUrl).toMatch(/ngspice[-.][A-Za-z0-9_-]+\.wasm$/);
	const asset = await request.get(wasmUrl);
	expect(asset.ok()).toBe(true);
	expect(asset.headers()['cache-control'] ?? '').toContain('immutable');
});

test('cancel terminates the worker and the next run is usable within the cold budget', async ({
	page
}) => {
	await page.goto('/analog-spike');
	await expect(page.getByTestId('analog-spike-status')).toHaveText('ok', { timeout: 15_000 });

	await page.evaluate((deck) => {
		void (window as unknown as { __analogSpike: { start: (deck: string) => Promise<unknown> } }).__analogSpike.start(deck);
	}, LONG_TRAN);
	await page.waitForTimeout(200);

	const cancelMs = await page.evaluate(() => {
		const started = performance.now();
		(window as unknown as { __analogSpike: { terminate: () => void } }).__analogSpike.terminate();
		return performance.now() - started;
	});
	expect(cancelMs).toBeLessThan(100);

	const result = await page.evaluate(async (deck) => {
		const started = performance.now();
		const spike = (window as unknown as { __analogSpike: { start: (deck: string) => Promise<{ ok: boolean }> } }).__analogSpike;
		const message = await spike.start(deck);
		return { ok: message.ok, totalMs: performance.now() - started };
	}, DIVIDER);
	expect(result.ok).toBe(true);
	expect(result.totalMs).toBeLessThan(10_000);
});
