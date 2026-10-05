import { expect, test } from '@playwright/test';

import { expectProbe, openFixture, setSwitch } from './logic';

// AE2: a cross-coupled NOR latch. The fixture wires q = NOR(r, qn) and
// qn = NOR(s, q), so S=1 sets Q, R=1 resets Q, and S=R=0 holds the last state.
// The both-high input is invalid for a NOR latch and is intentionally not part
// of this sequence: the symmetric delta-cycle model flags it as oscillation
// rather than picking a winner (the srLatch primitive defines that resolution).
const SEQUENCE = [
	{ s: 0, r: 0, q: 'X', qn: 'X' },
	{ s: 1, r: 0, q: '1', qn: '0' },
	{ s: 0, r: 0, q: '1', qn: '0' },
	{ s: 0, r: 1, q: '0', qn: '1' },
	{ s: 0, r: 0, q: '0', qn: '1' }
] as const;

test.describe('AE2: feedback determinism', () => {
	test('the SR latch settles to the same states on every run', async ({ page }) => {
		const { projectId } = await openFixture(page, 'sr-latch-project.json', {
			emailPrefix: 'sr-latch',
			projectName: 'sr-latch-fixture'
		});
		const projectUrl = `/projects/${projectId}`;
		const runs: string[][] = [];

		for (let run = 0; run < 3; run += 1) {
			if (run > 0) {
				await page.goto(projectUrl);
			}
			await expect(page.getByTestId('component-count')).toHaveText('6 components');
			const settled: string[] = [];
			for (const step of SEQUENCE) {
				await setSwitch(page, 'S', step.s as 0 | 1);
				await setSwitch(page, 'R', step.r as 0 | 1);
				await expectProbe(page, 'Q', step.q);
				await expectProbe(page, 'QN', step.qn);
				settled.push(`${step.q}${step.qn}`);
			}
			runs.push(settled);
		}

		expect(runs[1]).toEqual(runs[0]);
		expect(runs[2]).toEqual(runs[0]);
		expect(runs[0].at(-1)).toBe('01');
	});
});
