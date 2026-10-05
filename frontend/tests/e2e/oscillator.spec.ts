import { expect, test } from '@playwright/test';

import { expectProbe, openFixture, probe } from './logic';

// R7: a free-running oscillator. In delta-cycle mode the clock primitive is
// self-scheduling, so the engine iterates to the delta-cycle cap and flags the
// oscillating net instead of hanging. The probe is rendered as oscillating and
// a diagnostic is surfaced; stepping afterwards must stay responsive.
test.describe('R7: oscillator surfaces the oscillation flag', () => {
	test('flags the oscillating net and keeps the controls responsive', async ({ page }) => {
		await openFixture(page, 'oscillator-project.json', {
			emailPrefix: 'oscillator',
			projectName: 'oscillator-fixture'
		});
		await expect(page.getByTestId('component-count')).toHaveText('4 components');

		const diagnostic = page.locator('.diagnostics .entry', { hasText: 'oscillation detected' });
		await expect(diagnostic).toBeVisible({ timeout: 15_000 });
		await expect(diagnostic.locator('.kind')).toHaveText('oscillation');

		const oscillating = probe(page, 'OSC');
		await expect(oscillating).toHaveClass(/oscillating/);
		await expectProbe(page, 'OSC', 'X');
		await expectProbe(page, 'INV', 'X');

		const step = page.getByRole('button', { name: 'Step' });
		await expect(step).toBeEnabled();
		await step.click();
		await step.click();
		await expect(diagnostic).toBeVisible();
		await expect(page.getByTestId('component-count')).toHaveText('4 components');
	});
});
