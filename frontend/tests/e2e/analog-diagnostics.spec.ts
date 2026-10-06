import { expect, test } from '@playwright/test';

import { openFixture } from './logic';

test.describe('analog diagnostics', () => {
	test('a circuit without ground yields a diagnostic naming the net and no numbers', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-no-ground.json', {
			emailPrefix: 'analog-u6-noground',
			projectName: 'analog-u6-no-ground'
		});

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('failed');
		const entry = page.locator('.diagnostics .entry', { hasText: 'no ground reference' });
		await expect(entry).toBeVisible();
		await expect(entry).toContainText('vout');
		await expect(entry.getByRole('button', { name: 'Show net' })).toBeVisible();
		await entry.getByRole('button', { name: 'Show net' }).click();

		await expect(page.getByTestId('analysis-result')).toHaveCount(0);
		await expect(page.getByTestId('measurement-result')).toHaveCount(0);
	});

	test('a capacitor-isolated node yields the floating-net diagnostic and no numbers', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-floating.json', {
			emailPrefix: 'analog-u6-floating',
			projectName: 'analog-u6-floating'
		});

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('failed');
		const entry = page.locator('.diagnostics .entry', {
			hasText: 'no DC path to ground from net iso'
		});
		await expect(entry).toBeVisible();
		await expect(page.getByTestId('analysis-result')).toHaveCount(0);
		await expect(page.getByTestId('measurement-result')).toHaveCount(0);
	});

	test('a failed operating point yields guidance while the transient runs under labeled initial conditions', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-nonconvergent.json', {
			emailPrefix: 'analog-u6-conv',
			projectName: 'analog-u6-nonconvergent'
		});

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('partial', {
			timeout: 60_000
		});

		const op = page.locator('[data-testid="analysis-result"][data-analysis-id="op1"]');
		await expect(op).toHaveAttribute('data-status', 'failed');
		await expect(op.getByTestId('analysis-result-diagnostic')).toContainText('solver failed');
		await expect(op.getByTestId('analysis-result-diagnostic')).toContainText('DC path');

		const tran = page.locator('[data-testid="analysis-result"][data-analysis-id="tran1"]');
		await expect(tran).toHaveAttribute('data-status', 'complete');
		await expect(tran.getByTestId('analysis-state')).toHaveText('initial conditions');

		const ac = page.locator('[data-testid="analysis-result"][data-analysis-id="ac1"]');
		await expect(ac).toHaveAttribute('data-status', 'suppressed');
		await expect(ac.getByTestId('analysis-result-diagnostic')).toContainText(
			'AC requires a successful operating point'
		);
		await expect(ac).toContainText('no numbers');

		await expect(page.getByTestId('measurement-result')).toHaveAttribute(
			'data-status',
			'complete'
		);
	});

	test('a measurement that cannot bind produces a diagnostic and no numbers', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-unbound-measurement.json', {
			emailPrefix: 'analog-u6-unbound',
			projectName: 'analog-u6-unbound'
		});

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('partial', {
			timeout: 60_000
		});
		const entry = page.locator('.diagnostics .entry', { hasText: 'cannot bind' });
		await expect(entry).toContainText('missing-signal');
		await expect(entry).toContainText('v(nowhere)');

		const result = page.getByTestId('measurement-result');
		await expect(result).toHaveAttribute('data-status', 'failed');
		await expect(result).toContainText('no numbers');
	});
});
