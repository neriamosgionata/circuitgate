import { expect, test, type Locator, type Page } from '@playwright/test';

import { ANALOG_TOLERANCES, relativeError, withinRange } from '../../src/lib/engine/analog/tolerance';
import { loadFixture, openFixture } from './logic';

const V_T = 0.025864;
const RC_CORNER_HZ = 1 / (2 * Math.PI * 1e3 * 1e-7);

function thevenin(voltage: number, r1: number, r2: number) {
	return { vth: (voltage * r2) / (r1 + r2), rth: (r1 * r2) / (r1 + r2) };
}

async function runAndWait(page: Page): Promise<void> {
	await page.getByTestId('analog-run').click();
	await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
		timeout: 60_000
	});
}

function tab(page: Page, id: string): Locator {
	return page.locator(`[data-testid="result-tab"][data-tab="${id}"]`);
}

function numberFrom(value: string | null): number {
	expect(value).not.toBeNull();
	return Number(value);
}

async function traceRow(page: Page, name: string): Promise<Locator> {
	const row = page.locator(`[data-testid="scope-trace"][data-trace="${name}"]`);
	await expect(row).toBeVisible();
	return row;
}

async function scopeCursorAt(
	page: Page,
	seconds: number,
	traceName = 'v(vout)'
): Promise<{ t: number; value: number }> {
	const view = page.getByTestId('scope-view');
	const start = numberFrom(await view.getAttribute('data-window-start'));
	const end = numberFrom(await view.getAttribute('data-window-end'));
	const plot = page.getByTestId('scope-plot');
	const left = numberFrom(await plot.getAttribute('data-plot-left'));
	const right = numberFrom(await plot.getAttribute('data-plot-right'));
	await plot.scrollIntoViewIfNeeded();
	const box = await plot.boundingBox();
	expect(box).not.toBeNull();
	const x = box!.x + left + ((seconds - start) / (end - start)) * (right - left);
	await page.mouse.move(x, box!.y + box!.height / 2);
	const cursor = page.getByTestId('scope-cursor');
	await expect(cursor).toHaveAttribute('data-trace-name', traceName);
	return {
		t: numberFrom(await cursor.getAttribute('data-t')),
		value: numberFrom(await cursor.getAttribute('data-value'))
	};
}

async function bodeCursorAt(
	page: Page,
	hertz: number,
	traceName = 'v(vout)'
): Promise<{ gainDb: number; phaseDeg: number }> {
	const view = page.getByTestId('bode-view');
	const start = Math.log10(numberFrom(await view.getAttribute('data-freq-start')));
	const end = Math.log10(numberFrom(await view.getAttribute('data-freq-stop')));
	const plot = page.getByTestId('bode-plot');
	const left = numberFrom(await plot.getAttribute('data-plot-left'));
	const right = numberFrom(await plot.getAttribute('data-plot-right'));
	const trace = page.locator(`[data-testid="bode-trace"][data-trace="${traceName}"]`);
	await trace.scrollIntoViewIfNeeded();
	await trace.click();
	await expect(trace).toHaveAttribute('data-active', 'true');
	await plot.scrollIntoViewIfNeeded();
	const box = await plot.boundingBox();
	expect(box).not.toBeNull();
	const x = box!.x + left + ((Math.log10(hertz) - start) / (end - start)) * (right - left);
	await page.mouse.move(x, box!.y + box!.height * 0.3);
	const cursor = page.getByTestId('bode-cursor');
	await expect(cursor).toHaveAttribute('data-trace-name', traceName);
	return {
		gainDb: numberFrom(await cursor.getAttribute('data-gain-db')),
		phaseDeg: numberFrom(await cursor.getAttribute('data-phase-deg'))
	};
}

async function injectFixture(page: Page, name: string): Promise<void> {
	const fixture = await loadFixture(`analog-results/${name}`);
	await page.addInitScript((data) => {
		(window as unknown as Record<string, unknown>)['__circuitgateAnalogResultsFixture'] = data;
	}, fixture);
}

test.describe('analog inspection views', () => {
	test('AE1: BJT bias operating point matches hand calculation on canvas and in the table', async ({
		page
	}) => {
		await openFixture(page, 'analog-u7-bjt-bias.json', {
			emailPrefix: 'analog-u7-ae1',
			projectName: 'analog-u7-ae1'
		});
		await runAndWait(page);

		await tab(page, 'op').click();
		await expect(tab(page, 'op')).toHaveAttribute('aria-selected', 'true');
		const collectorRow = page.locator(
			'[data-testid="op-value-row"][data-variable="v(collector)"]'
		);
		const baseRow = page.locator('[data-testid="op-value-row"][data-variable="v(base)"]');
		await expect(collectorRow).toBeVisible();
		await expect(baseRow).toBeVisible();
		const collectorVoltage = numberFrom(await collectorRow.getAttribute('data-value'));
		const baseVoltage = numberFrom(await baseRow.getAttribute('data-value'));

		const { vth, rth } = thevenin(12, 470e3, 100e3);
		let collectorCurrent = 3.5e-3;
		let vbe = 0;
		for (let iteration = 0; iteration < 200; iteration += 1) {
			const vce = 12 - 2200 * collectorCurrent;
			vbe = V_T * Math.log(collectorCurrent / 1e-14);
			collectorCurrent = 200 * ((vth - vbe) / rth) * (1 + vce / 100);
		}
		const referenceVoltage = 12 - 2200 * collectorCurrent;

		expect(relativeError(collectorVoltage, referenceVoltage)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.opNonlinear
		);
		expect(relativeError(baseVoltage, vbe)).toBeLessThanOrEqual(ANALOG_TOLERANCES.opNonlinear);
		expect(withinRange(baseVoltage, 0.6, 0.8)).toBe(true);

		const currentRow = page
			.locator('[data-testid="op-value-row"][data-kind="branch current"]')
			.first();
		await expect(currentRow).toBeVisible();
		const branchCurrent = Math.abs(
			numberFrom(await currentRow.getAttribute('data-value'))
		);
		expect(relativeError(branchCurrent, collectorCurrent)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.opNonlinear
		);

		const collectorAnnotation = page.locator(
			'[data-testid="op-annotation"][data-net="collector"]'
		);
		const baseAnnotation = page.locator('[data-testid="op-annotation"][data-net="base"]');
		await expect(collectorAnnotation).toBeVisible();
		await expect(baseAnnotation).toBeVisible();
		expect(numberFrom(await collectorAnnotation.getAttribute('data-value'))).toBeCloseTo(
			collectorVoltage,
			6
		);
		expect(numberFrom(await baseAnnotation.getAttribute('data-value'))).toBeCloseTo(
			baseVoltage,
			6
		);
		const currentAnnotation = page.locator(
			'[data-testid="op-annotation"][data-component-id="vcc"]'
		);
		await expect(currentAnnotation).toBeVisible();
	});

	test('AE2: RC plus clamp transient keeps shape and time constant across two traces', async ({
		page
	}) => {
		await openFixture(page, 'analog-u7-rc-clamp.json', {
			emailPrefix: 'analog-u7-ae2',
			projectName: 'analog-u7-ae2'
		});
		await runAndWait(page);

		await tab(page, 'scope').click();
		await expect(tab(page, 'scope')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('scope-view')).not.toHaveAttribute('data-first-render-ms', '');
		await traceRow(page, 'v(vin)');
		const voutRow = await traceRow(page, 'v(vout)');
		const fullMin = numberFrom(await voutRow.getAttribute('data-min'));
		const windowMin = numberFrom(await voutRow.getAttribute('data-window-min'));
		expect(fullMin).toBeCloseTo(windowMin, 8);
		expect(withinRange(Math.abs(fullMin), 0.6, 0.8)).toBe(true);

		await voutRow.click();
		// The diode recovery has a brief fast segment; measure tau from two
		// samples well inside the clean RC decay, one time constant apart.
		const early = await scopeCursorAt(page, 560e-6);
		const late = await scopeCursorAt(page, 660e-6);
		const estimatedTau = 100e-6 / Math.log(early.value / late.value);
		expect(relativeError(estimatedTau, 100e-6)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.tranTimeConstant
		);

		await page.getByTestId('scope-zoom-in').click();
		const zoomedEarly = await scopeCursorAt(page, 560e-6);
		const zoomedLate = await scopeCursorAt(page, 660e-6);
		const zoomedTau = 100e-6 / Math.log(zoomedEarly.value / zoomedLate.value);
		expect(relativeError(zoomedTau, 100e-6)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.tranTimeConstant
		);
	});

	test('AE3: first-order filter AC shows the corner and roll-off in the Bode view', async ({
		page
	}) => {
		await openFixture(page, 'analog-u7-rc-ac.json', {
			emailPrefix: 'analog-u7-ae3',
			projectName: 'analog-u7-ae3'
		});
		await runAndWait(page);

		await expect(tab(page, 'bode')).toHaveAttribute('aria-selected', 'true');
		const trace = page.locator('[data-testid="bode-trace"][data-trace="v(vout)"]');
		await expect(trace).toBeVisible();
		const detectedCorner = numberFrom(await trace.getAttribute('data-corner-hz'));
		expect(relativeError(detectedCorner, RC_CORNER_HZ)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.acCorner
		);

		const atCorner = await bodeCursorAt(page, RC_CORNER_HZ);
		expect(Math.abs(atCorner.gainDb - -3.0103)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.acMagnitudeDb
		);
		expect(Math.abs(atCorner.phaseDeg - -45)).toBeLessThanOrEqual(1.5);

		const aDecadeUp = await bodeCursorAt(page, RC_CORNER_HZ * 10);
		expect(Math.abs(aDecadeUp.gainDb - -20.043)).toBeLessThanOrEqual(1);
	});

	test('views render from result fixtures alone and decimation preserves peaks and the time constant', async ({
		page
	}) => {
		const wasmRequests: string[] = [];
		page.on('request', (request) => {
			if (/ngspice.*\.wasm/.test(request.url())) wasmRequests.push(request.url());
		});
		await injectFixture(page, 'rc-clamp-tran.json');
		await openFixture(page, 'analog-u7-rc-ac.json', {
			emailPrefix: 'analog-u7-fixture',
			projectName: 'analog-u7-fixture'
		});

		await expect(tab(page, 'scope')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('scope-view')).not.toHaveAttribute('data-first-render-ms', '');
		await expect(page.getByTestId('scope-trace')).toHaveCount(2);
		const voutRow = await traceRow(page, 'v(vout)');
		expect(await voutRow.getAttribute('data-points')).toBe('10001');
		const fullMin = numberFrom(await voutRow.getAttribute('data-min'));
		const windowMin = numberFrom(await voutRow.getAttribute('data-window-min'));
		expect(fullMin).toBeCloseTo(windowMin, 8);
		expect(fullMin).toBeCloseTo(-0.65, 3);
		await expect(page.getByTestId('scope-resolution')).toHaveAttribute(
			'data-mode',
			'decimated'
		);

		await voutRow.click();
		const atTau = await scopeCursorAt(page, 100e-6);
		expect(relativeError(atTau.value, 1 - Math.exp(-1))).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.tranSample
		);

		for (let click = 0; click < 8; click += 1) {
			await page.getByTestId('scope-zoom-in').click();
		}
		await expect(page.getByTestId('scope-resolution')).toHaveAttribute('data-mode', 'full');

		await tab(page, 'meas').click();
		await expect(page.getByTestId('measurement-result')).toHaveCount(2);
		const rms = page.locator('[data-testid="measurement-result"][data-name="vout-rms"]');
		const rmsValue = numberFrom(await rms.getAttribute('data-value'));
		expect(rmsValue).toBeGreaterThan(0.2);
		await expect(rms.locator('[data-testid="measurement-unit"]')).toHaveText('V');
		const range = page.locator('[data-testid="measurement-result"][data-name="vout-range"]');
		await expect(range.locator('[data-testid="measurement-unit"]')).toHaveText('V');
		expect(numberFrom(await range.getAttribute('data-min'))).toBeCloseTo(-0.65, 3);
		expect(numberFrom(await range.getAttribute('data-max'))).toBeGreaterThan(0.9);

		expect(wasmRequests).toHaveLength(0);
	});

	test('AC fixtures render the Bode view without the engine', async ({ page }) => {
		const wasmRequests: string[] = [];
		page.on('request', (request) => {
			if (/ngspice.*\.wasm/.test(request.url())) wasmRequests.push(request.url());
		});
		await injectFixture(page, 'rc-lowpass-ac.json');
		await openFixture(page, 'analog-u7-rc-ac.json', {
			emailPrefix: 'analog-u7-fixture-ac',
			projectName: 'analog-u7-fixture-ac'
		});

		await expect(tab(page, 'bode')).toHaveAttribute('aria-selected', 'true');
		const trace = page.locator('[data-testid="bode-trace"][data-trace="v(vout)"]');
		await expect(trace).toBeVisible();
		const detectedCorner = numberFrom(await trace.getAttribute('data-corner-hz'));
		expect(relativeError(detectedCorner, RC_CORNER_HZ)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.acCorner
		);
		const atCorner = await bodeCursorAt(page, RC_CORNER_HZ);
		expect(Math.abs(atCorner.gainDb - -3.0103)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.acMagnitudeDb
		);
		expect(Math.abs(atCorner.phaseDeg - -45)).toBeLessThanOrEqual(1.5);
		expect(wasmRequests).toHaveLength(0);
	});

	test('before any run each result tab renders its empty state', async ({ page }) => {
		await openFixture(page, 'analog-u7-rc-ac.json', {
			emailPrefix: 'analog-u7-empty',
			projectName: 'analog-u7-empty'
		});
		await expect(page.getByTestId('analysis-result')).toHaveCount(0);
		for (const id of ['scope', 'bode', 'op', 'meas']) {
			await tab(page, id).click();
			await expect(
				page.locator(`[data-testid="tab-${id}"] [data-testid="tab-empty"]`)
			).toBeVisible();
		}
	});

	test('after a document edit every result tab shows the stale treatment and the re-run action', async ({
		page
	}) => {
		await openFixture(page, 'analog-u7-bjt-bias.json', {
			emailPrefix: 'analog-u7-stale-tabs',
			projectName: 'analog-u7-stale-tabs'
		});
		await runAndWait(page);

		await page.getByRole('button', { name: 'resistor', exact: true }).click();
		const canvas = page.locator('.canvas-slot canvas');
		const box = await canvas.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.click(box!.x + 260, box!.y + 180);
		await expect(page.getByTestId('component-count')).toHaveText(/7 components/);
		await expect(page.getByTestId('analog-stale')).toBeVisible();

		for (const id of ['scope', 'bode', 'op', 'meas']) {
			await tab(page, id).click();
			const panel = page.locator(`[data-testid="tab-${id}"]`);
			await expect(panel.locator('[data-testid="tab-stale"]')).toBeVisible();
			await expect(panel.getByTestId('tab-rerun')).toBeVisible();
		}

		await tab(page, 'op').click();
		await page.locator('[data-testid="tab-op"] [data-testid="tab-rerun"]').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		await expect(page.getByTestId('analog-stale')).toHaveCount(0);
	});

	test('AE4: multi-sensor front-end matches hand calculation in the operating point and measurements', async ({
		page
	}) => {
		await openFixture(page, 'analog-u7-multisensor.json', {
			emailPrefix: 'analog-u7-ae4',
			projectName: 'analog-u7-ae4'
		});
		await runAndWait(page);

		await tab(page, 'op').click();
		const expectations: readonly (readonly [string, number, number])[] = [
			['v(sa)', 6, 0.01],
			['v(sb)', 3.75, 0.01],
			['v(outa)', 6, 0.05],
			['v(outb)', 3.75, 0.05],
			['v(outaf)', 6, 0.05]
		];
		for (const [variable, expected, tolerance] of expectations) {
			const row = page.locator(`[data-testid="op-value-row"][data-variable="${variable}"]`);
			await expect(row).toBeVisible();
			const value = numberFrom(await row.getAttribute('data-value'));
			expect(relativeError(value, expected), variable).toBeLessThanOrEqual(tolerance);
		}

		await tab(page, 'meas').click();
		await expect(page.getByTestId('measurement-result')).toHaveCount(3);
		const rmsA = page.locator('[data-testid="measurement-result"][data-name="sensor-a-rms"]');
		expect(
			relativeError(numberFrom(await rmsA.getAttribute('data-value')), 6)
		).toBeLessThanOrEqual(0.02);
		const rmsB = page.locator('[data-testid="measurement-result"][data-name="sensor-b-rms"]');
		expect(
			relativeError(numberFrom(await rmsB.getAttribute('data-value')), 3.75)
		).toBeLessThanOrEqual(0.02);
		const rangeB = page.locator('[data-testid="measurement-result"][data-name="sensor-b-range"]');
		expect(
			relativeError(numberFrom(await rangeB.getAttribute('data-min')), 3.75)
		).toBeLessThanOrEqual(0.02);
		expect(
			relativeError(numberFrom(await rangeB.getAttribute('data-max')), 3.75)
		).toBeLessThanOrEqual(0.02);
	});
});
