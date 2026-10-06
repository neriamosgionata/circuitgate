import { expect, test, type Page } from '@playwright/test';

import { apiCreateProject, createVerifiedAccount, uniqueEmail } from './helpers';
import { loadFixture } from './logic';

interface RunMeasurement {
	label: string;
	ms: number;
}

const TAB_FOR_RESULT: Record<string, string> = {
	'op-value-row': 'op',
	'scope-view': 'scope',
	'bode-view': 'bode'
};

async function timedRun(page: Page, label: string, resultTestId: string): Promise<RunMeasurement> {
	const started = Date.now();
	await page.getByTestId('analog-run').click();
	await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
		timeout: 60_000
	});
	const tabId = TAB_FOR_RESULT[resultTestId];
	if (tabId) {
		await page.locator(`[data-testid="result-tab"][data-tab="${tabId}"]`).click();
	}
	const first = page.getByTestId(resultTestId).first();
	if (resultTestId === 'scope-view') {
		await expect(first).not.toHaveAttribute('data-first-render-ms', '', { timeout: 10_000 });
	} else {
		await expect(first).toBeVisible();
	}
	const ms = Date.now() - started;
	console.log(`[perf] ${label}: ${ms} ms`);
	return { label, ms };
}

async function openProject(page: Page, name: string, fixture: string): Promise<void> {
	const project = await apiCreateProject(page, name, await loadFixture(fixture));
	await page.goto(`/projects/${String(project['id'])}`);
}

test.describe('analog performance', () => {
	test('cold first run and warm op/tran/ac budgets on the reference fixtures', async ({
		page
	}) => {
		const email = uniqueEmail('analog-perf-run');
		await createVerifiedAccount(page, email);

		await openProject(page, 'perf-op', 'analog-u7-perf-op.json');
		const cold = await timedRun(page, 'cold first run (op, includes engine load)', 'op-value-row');
		expect(cold.ms).toBeLessThanOrEqual(10_000);
		const warmOp = await timedRun(page, 'warm .op', 'op-value-row');
		expect(warmOp.ms).toBeLessThanOrEqual(500);

		await openProject(page, 'perf-tran', 'analog-u7-perf-tran.json');
		await timedRun(page, 'tran warm-up', 'scope-view');
		const warmTran = await timedRun(page, 'warm .tran (1 ms at 1 us max step)', 'scope-view');
		expect(warmTran.ms).toBeLessThanOrEqual(2_000);

		await openProject(page, 'perf-ac', 'analog-u7-perf-ac.json');
		await timedRun(page, 'ac warm-up', 'bode-view');
		const warmAc = await timedRun(page, 'warm .ac (101 points)', 'bode-view');
		expect(warmAc.ms).toBeLessThanOrEqual(1_000);
	});

	test('a million-point, eight-trace transient renders and stays interactive', async ({
		page
	}) => {
		await page.addInitScript(
			(config: { points: number; traces: number }) => {
				const time = new Float64Array(config.points);
				const span = 1e-3;
				for (let index = 0; index < config.points; index += 1) {
					time[index] = (index / (config.points - 1)) * span;
				}
				const variables: Array<{ name: string; type: string; real: Float64Array }> = [
					{ name: 'time', type: 'time', real: time }
				];
				for (let trace = 0; trace < config.traces; trace += 1) {
					const real = new Float64Array(config.points);
					const amplitude = 0.5 + trace * 0.1;
					const frequency = 1000 * (trace + 1);
					const offset = trace % 2 === 0 ? 0.2 : -0.2;
					for (let index = 0; index < config.points; index += 1) {
						real[index] =
							amplitude * Math.sin(2 * Math.PI * frequency * time[index]) + offset;
					}
					variables.push({ name: `v(out${trace})`, type: 'voltage', real });
				}
				(window as unknown as Record<string, unknown>)['__circuitgateAnalogResultsFixture'] =
					{
						shapeVersion: 1,
						lastCompletedKind: 'tran',
						analyses: [{ id: 'tran1', kind: 'tran', status: 'complete', variables }],
						measurements: []
					};
			},
			{ points: 1_000_000, traces: 8 }
		);

		const email = uniqueEmail('analog-perf-view');
		await createVerifiedAccount(page, email);
		await openProject(page, 'perf-million', 'analog-u7-perf-op.json');

		await expect(page.getByTestId('scope-trace')).toHaveCount(8, { timeout: 30_000 });
		const view = page.getByTestId('scope-view');
		await expect(view).not.toHaveAttribute('data-first-render-ms', '', { timeout: 10_000 });
		const firstRenderMs = Number(await view.getAttribute('data-first-render-ms'));
		console.log(`[perf] million-point first render: ${firstRenderMs} ms`);
		expect(firstRenderMs).toBeLessThanOrEqual(100);

		const resolution = page.getByTestId('scope-resolution');
		await expect(resolution).toHaveAttribute('data-cap-bound', 'true');
		expect(await resolution.textContent()).toContain('point cap');

		const timing = await page.evaluate(async () => {
			const plot = document.querySelector('[data-testid="scope-plot"]') as HTMLElement;
			const viewElement = document.querySelector('[data-testid="scope-view"]') as HTMLElement;
			const rect = plot.getBoundingClientRect();
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			const nextFrame = () =>
				new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			const times: number[] = [];
			for (let index = 0; index < 30; index += 1) {
				plot.dispatchEvent(
					new WheelEvent('wheel', {
						deltaY: index % 2 === 0 ? -120 : 120,
						clientX: centerX,
						clientY: centerY,
						bubbles: true,
						cancelable: true
					})
				);
				await nextFrame();
				times.push(Number(viewElement.getAttribute('data-last-render-ms')));
			}
			plot.dispatchEvent(
				new PointerEvent('pointerdown', {
					pointerId: 7,
					clientX: centerX,
					clientY: centerY,
					bubbles: true
				})
			);
			for (let index = 0; index < 20; index += 1) {
				plot.dispatchEvent(
					new PointerEvent('pointermove', {
						pointerId: 7,
						clientX: centerX + index * 4,
						clientY: centerY,
						bubbles: true
					})
				);
				await nextFrame();
				times.push(Number(viewElement.getAttribute('data-last-render-ms')));
			}
			plot.dispatchEvent(
				new PointerEvent('pointerup', {
					pointerId: 7,
					clientX: centerX + 80,
					clientY: centerY,
					bubbles: true
				})
			);
			const sorted = [...times].sort((left, right) => left - right);
			const index = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
			const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
			return { p95: sorted[index], mean };
		});
		const fps = 1000 / timing.mean;
		console.log(
			`[perf] million-point 8-trace pan/zoom draw p95: ${timing.p95.toFixed(2)} ms, mean ${timing.mean.toFixed(2)} ms (~${fps.toFixed(1)} fps)`
		);
		expect(timing.p95).toBeLessThanOrEqual(33.3);

		await page.evaluate(() => {
			const plot = document.querySelector('[data-testid="scope-plot"]') as HTMLElement;
			const rect = plot.getBoundingClientRect();
			for (let index = 0; index < 80; index += 1) {
				plot.dispatchEvent(
					new WheelEvent('wheel', {
						deltaY: -120,
						clientX: rect.left + rect.width / 2,
						clientY: rect.top + rect.height / 2,
						bubbles: true,
						cancelable: true
					})
				);
			}
		});
		await expect(resolution).toHaveAttribute('data-mode', 'full', { timeout: 5_000 });
		await expect(resolution).toHaveAttribute('data-cap-bound', 'true');
	});
});
