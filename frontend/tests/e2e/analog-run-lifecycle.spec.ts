import { expect, test } from '@playwright/test';

import { apiGetProject, placeComponent } from './helpers';
import { openFixture } from './logic';

const WASM_PATTERN = /ngspice.*\.wasm/;

interface SavedAnalysis {
	id: string;
	kind: string;
	params: Record<string, unknown>;
}

function savedAnalyses(document: unknown): SavedAnalysis[] {
	return (document as { circuit: { analyses: SavedAnalysis[] } }).circuit.analyses;
}

test.describe('analog run lifecycle', () => {
	test('seeds KTD5 defaults and runs every configured analysis with progress and results', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-rc.json', {
			emailPrefix: 'analog-u6-run',
			projectName: 'analog-u6-rc'
		});

		await expect(page.getByTestId('analysis-tran-duration')).toHaveValue('1m');
		await expect(page.getByTestId('analysis-tran-maxstep')).toHaveValue('1u');
		await expect(page.getByTestId('analysis-ac-start')).toHaveValue('10');
		await expect(page.getByTestId('analysis-ac-stop')).toHaveValue('1meg');
		await expect(page.getByTestId('analysis-ac-points')).toHaveValue('20');

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-progress')).toBeVisible();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});

		await expect(page.getByTestId('analysis-result')).toHaveCount(3);
		for (const analysisId of ['op1', 'tran1', 'ac1']) {
			await expect(
				page.locator(`[data-testid="analysis-result"][data-analysis-id="${analysisId}"]`)
			).toHaveAttribute('data-status', 'complete');
		}
		const measurement = page.getByTestId('measurement-result');
		await expect(measurement).toHaveAttribute('data-status', 'complete');
		await expect(measurement).toContainText('vout-rms');
	});

	test('cancel mid-run reports cancelled and never presents partial results as final', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-rc.json', {
			emailPrefix: 'analog-u6-cancel',
			projectName: 'analog-u6-cancel'
		});
		await page.route(WASM_PATTERN, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await route.continue();
		});

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-progress')).toBeVisible();
		await expect(page.getByTestId('analog-progress-phase')).toHaveText('Loading engine…');
		await page.getByTestId('analog-cancel').click();

		await expect(page.getByTestId('analog-cancelled')).toHaveText('Run cancelled.');
		await expect(page.getByTestId('analog-run-status')).toHaveText('cancelled');
		await expect(page.getByTestId('analysis-result')).toHaveCount(0);
		await expect(page.getByTestId('measurement-result')).toHaveCount(0);
	});

	test('rejects parameters beyond the caps before the solver starts', async ({ page }) => {
		await openFixture(page, 'analog-u6-rc.json', {
			emailPrefix: 'analog-u6-caps',
			projectName: 'analog-u6-caps'
		});

		await page.getByTestId('analysis-tran-duration').fill('10');
		await page.getByTestId('analysis-tran-maxstep').fill('1u');
		await page.getByTestId('analog-run').click();

		await expect(
			page.locator('.diagnostics .entry', { hasText: 'the cap is 1000000' })
		).toBeVisible();
		await expect(page.getByTestId('analog-run-status')).toHaveText('failed');
		await expect(page.getByTestId('analog-progress')).toHaveCount(0);
		await expect(page.getByTestId('analysis-result')).toHaveCount(0);
	});

	test('a load failure renders Retry and Dismiss, and retry re-enters loading', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-rc.json', {
			emailPrefix: 'analog-u6-load',
			projectName: 'analog-u6-load'
		});
		await page.route(WASM_PATTERN, (route) => route.fulfill({ status: 503, body: 'missing' }));

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-progress')).toBeVisible();
		await expect(page.getByTestId('analog-failed')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('analog-failed-message')).toContainText(
			'engine asset fetch failed'
		);
		await expect(page.getByTestId('analog-retry')).toBeVisible();
		await expect(page.getByTestId('analog-dismiss')).toBeVisible();

		await page.unroute(WASM_PATTERN);
		await page.getByTestId('analog-retry').click();
		await expect(page.getByTestId('analog-progress')).toBeVisible();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		await expect(page.getByTestId('analysis-result')).toHaveCount(3);
	});

	test('document edits keep results under a stale banner with a re-run action', async ({
		page
	}) => {
		await openFixture(page, 'analog-u6-rc.json', {
			emailPrefix: 'analog-u6-stale',
			projectName: 'analog-u6-stale'
		});

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		await expect(page.getByTestId('analysis-result')).toHaveCount(3);

		await placeComponent(page, 'resistor');
		await expect(page.getByTestId('component-count')).toHaveText(/5 components/);
		await expect(page.getByTestId('analog-stale')).toBeVisible();
		await expect(page.getByTestId('analysis-result')).toHaveCount(3);

		await page.getByTestId('analog-rerun').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		await expect(page.getByTestId('analog-stale')).toHaveCount(0);
	});

	test('measurement definitions round-trip through save and render after a run', async ({
		page
	}) => {
		const { projectId } = await openFixture(page, 'analog-u6-rc.json', {
			emailPrefix: 'analog-u6-meas',
			projectName: 'analog-u6-meas'
		});
		const seededRow = page.locator('[data-testid="measurement-row"][data-measurement-id="meas1"]');
		await expect(seededRow.getByTestId('measurement-name')).toHaveValue('vout-rms');
		await expect(seededRow.getByTestId('measurement-type')).toHaveValue('rms');
		await expect(seededRow.getByTestId('measurement-signal')).toHaveValue('v(vout)');
		await expect(seededRow.getByTestId('measurement-window-start')).toHaveValue('200u');

		await page.getByTestId('measurement-add').click();
		const row = page.getByTestId('measurement-row').nth(1);
		await row.getByTestId('measurement-name').fill('coil-power');
		await row.getByTestId('measurement-type').selectOption('power');
		await row.getByTestId('measurement-signal').selectOption('i(v1)');

		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');

		const saved = await apiGetProject(page, projectId);
		const added = savedAnalyses(saved['document']).find(
			(entry) => entry.kind === 'meas' && entry.params['name'] === 'coil-power'
		);
		expect(added).toBeTruthy();
		expect(added!.params['type']).toBe('power');
		expect(added!.params['signal']).toBe('i(v1)');

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		await expect(page.getByTestId('measurement-result')).toHaveCount(2);
	});
});
