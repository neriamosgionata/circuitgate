import { expect, test } from '@playwright/test';

import { apiCreateProject, createVerifiedAccount, uniqueEmail } from './helpers';
import { expectProbe, loadFixture } from './logic';

// R10 performance exit criteria: input-toggle-to-visible-update p95 stays
// under 50 ms at 2,000 components, and project load stays under 1 s at ALU
// scale. Both are measured through the app's own path (browser click ->
// simulation worker -> Svelte DOM update), with numbers written to the output.
const PERF_COMPONENTS = 2000;
const OFFSCREEN_CHAINS = 399;
const CHAIN_DEPTH = 5;

function percentile(samples: readonly number[], fraction: number): number {
	const sorted = [...samples].sort((left, right) => left - right);
	const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
	return sorted[index] ?? Number.POSITIVE_INFINITY;
}

function perfDocument(): Record<string, unknown> {
	// A visible switch -> three buffers -> probe chain (the toggled path),
	// plus 399 five-buffer chains parked beyond the initial viewport. The
	// document still compiles and settles all 2,000 components per toggle,
	// while the renderer culls the offscreen bulk through its normal
	// viewport-culling path. This mirrors ALU-scale work: bounded fanout,
	// bounded wire length, most of the design outside the current view.
	const components: Array<Record<string, unknown>> = [
		{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'n0' } },
		{ id: 'b1', kind: 'buffer', inputs: { a: 'n0' }, outputs: { out: 'n1' } },
		{ id: 'b2', kind: 'buffer', inputs: { a: 'n1' }, outputs: { out: 'n2' } },
		{ id: 'b3', kind: 'buffer', inputs: { a: 'n2' }, outputs: { out: 'n3' } },
		{ id: 'out', kind: 'probe', inputs: { in: 'n3' }, outputs: {} }
	];
	const layouts: Record<string, { position: { x: number; y: number }; label?: string }> = {
		sw: { position: { x: 40, y: 40 }, label: 'IN' },
		b1: { position: { x: 170, y: 40 } },
		b2: { position: { x: 300, y: 40 } },
		b3: { position: { x: 430, y: 40 } },
		out: { position: { x: 560, y: 40 }, label: 'OUT' }
	};
	for (let chain = 0; chain < OFFSCREEN_CHAINS; chain += 1) {
		let previous = `off${chain}_in`;
		for (let depth = 0; depth < CHAIN_DEPTH; depth += 1) {
			const id = `c${chain}_${depth}`;
			components.push({
				id,
				kind: 'buffer',
				inputs: { a: previous },
				outputs: { out: `off${chain}_${depth}` }
			});
			layouts[id] = {
				position: { x: 900 + (chain % 20) * 120, y: 600 + Math.floor(chain / 20) * 80 }
			};
			previous = `off${chain}_${depth}`;
		}
	}
	if (components.length !== PERF_COMPONENTS) {
		throw new Error(`performance fixture must hold ${PERF_COMPONENTS} components`);
	}
	return {
		circuit: { schemaVersion: 1, components },
		definitions: {},
		layouts: { '': layouts }
	};
}

test.describe('R10: ALU-scale performance', () => {
	test('measures project load and toggle-to-visible latency', async ({ page }) => {
		const email = uniqueEmail('performance');
		await createVerifiedAccount(page, email);

		const alu = await loadFixture('alu-project.json');
		const aluProject = await apiCreateProject(page, 'perf-alu', alu);
		const aluId = String(aluProject['id']);
		const aluStart = Date.now();
		await page.goto(`/projects/${aluId}`);
		await expect(page.getByTestId('component-count')).toHaveText('65 components');
		const aluLoadMs = Date.now() - aluStart;
		console.log(`[perf] ALU project load: ${aluLoadMs} ms`);
		expect(aluLoadMs).toBeLessThan(1000);

		const perfProject = await apiCreateProject(page, 'perf-2000', perfDocument());
		const perfId = String(perfProject['id']);
		const perfStart = Date.now();
		await page.goto(`/projects/${perfId}`);
		await expect(page.getByTestId('component-count')).toHaveText(`${PERF_COMPONENTS} components`);
		const perfLoadMs = Date.now() - perfStart;
		console.log(`[perf] ${PERF_COMPONENTS}-component project load: ${perfLoadMs} ms`);
		await expectProbe(page, 'OUT', '0');

		const samples = await page.evaluate(async (iterations) => {
			const button = document.querySelector('.io button.switch') as HTMLButtonElement | null;
			const probeValue = document.querySelector('.probe .value') as HTMLElement | null;
			if (!button || !probeValue) throw new Error('performance controls are not rendered');
			const results: number[] = [];
			for (let index = 0; index < iterations; index += 1) {
				const target = probeValue.textContent?.trim() === '1' ? '0' : '1';
				const start = performance.now();
				button.click();
				while (probeValue.textContent?.trim() !== target) {
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				}
				results.push(performance.now() - start);
			}
			return results;
		}, 20);

		const p95 = percentile(samples, 0.95);
		const worst = Math.max(...samples);
		const best = Math.min(...samples);
		console.log(
			`[perf] toggle-to-visible p95: ${p95.toFixed(2)} ms (min ${best.toFixed(2)} ms, max ${worst.toFixed(2)} ms, n=${samples.length})`
		);
		expect(p95).toBeLessThan(50);
	});
});
