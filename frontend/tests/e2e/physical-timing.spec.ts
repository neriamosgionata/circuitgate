import { expect, test, type Page } from '@playwright/test';

import { openFixture, probe, switchButton } from './logic';

async function selectPhysical(page: Page): Promise<void> {
	await page.getByTestId('simulation-mode').selectOption('physical');
	await expect(page.getByTestId('sim-time')).toHaveText('0s');
}

async function step(page: Page, count: number): Promise<void> {
	const button = page.getByRole('button', { name: 'Step', exact: true });
	for (let index = 0; index < count; index += 1) await button.click();
}

test.describe('physical timing mode', () => {
	test('setup violation pauses Run with X and a time-window diagnostic', async ({ page }) => {
		await openFixture(page, 'physical-timing-setup.json', { emailPrefix: 'physical-setup' });
		await selectPhysical(page);

		await page.getByRole('button', { name: 'Run', exact: true }).click();
		await expect(page.getByTestId('sim-pause-reason')).toContainText('timing violation', {
			timeout: 10_000
		});
		await expect(page.getByTestId('sim-time')).toHaveText('30ns');
		await expect(probe(page, 'Q').locator('.value')).toHaveText('X');

		const diagnostic = page.locator('.diagnostics .entry').filter({ hasText: 'setup violation' });
		await expect(diagnostic).toContainText('ff');
		await expect(diagnostic).toContainText('28ns–30ns');
	});

	test('a reconvergent glitch appears and clears on the probe', async ({ page }) => {
		await openFixture(page, 'physical-timing-glitch.json', { emailPrefix: 'physical-glitch' });
		await selectPhysical(page);

		// Let both 2 ns and 5 ns paths settle to zero before the edge.
		await step(page, 3);
		await expect(page.getByTestId('sim-time')).toHaveText('7ns');

		await switchButton(page, 'SW').click();
		await step(page, 1); // process the switch at 7 ns
		await step(page, 2); // FAST rises at 9 ns, XOR pulses at 11 ns
		await expect(page.getByTestId('sim-time')).toHaveText('11ns');
		await expect.poll(() => probe(page, 'OUT').locator('.value').textContent()).toBe('1');

		await step(page, 2); // SLOW rises at 12 ns, XOR clears at 14 ns
		await expect(page.getByTestId('sim-time')).toHaveText('14ns');
		await expect.poll(() => probe(page, 'OUT').locator('.value').textContent()).toBe('0');
	});
});
