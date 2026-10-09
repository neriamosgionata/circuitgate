import { expect, test, type Page } from '@playwright/test';

import { apiCreateProject, apiGetProject, createVerifiedAccount, uniqueEmail } from './helpers';

// U5: assisted stepping. Dragging q0 to d0 across two 16-bit registers arms
// q1 to d1 (visible in the canvas hint); a mismatched connection arms
// nothing; Escape clears the armed state. Coordinates assume the default
// viewport (scale 1, offset 48,48): screen = world + 48.

function seedDocument(): Record<string, unknown> {
	const reg = (id: string) => ({
		id,
		kind: 'register',
		inputs: {},
		outputs: {},
		params: { width: 16 }
	});
	return {
		circuit: { schemaVersion: 1, components: [reg('r1'), reg('r2')], models: [], analyses: [] },
		definitions: {},
		layouts: {
			'': { r1: { position: { x: 120, y: 200 } }, r2: { position: { x: 500, y: 200 } } }
		}
	};
}

// Register geometry at width 16: 17 inputs (clk + d0..d15), 16 outputs
// (q0..q15); body 64x282 from componentSize. Pin world coords below.
const Q0 = { x: 120 + 64, y: 200 + (282 * 1) / 17 };
const D0 = { x: 500, y: 200 + (282 * 2) / 18 };

function toScreen(box: { x: number; y: number }, world: { x: number; y: number }) {
	return { x: box.x + world.x + 48, y: box.y + world.y + 48 };
}

async function dragWire(page: Page, box: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }) {
	const a = toScreen(box, from);
	const b = toScreen(box, to);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps: 12 });
	await page.mouse.up();
	await page.waitForTimeout(400);
}

async function clickUntilSelected(page: Page, x: number, y: number) {
	for (let attempt = 0; attempt < 6; attempt++) {
		await page.mouse.click(x, y);
		await page.waitForTimeout(300);
		if ((await page.locator('.selection').count()) === 1) return;
	}
	throw new Error('canvas hit-testing never engaged');
}

test.describe('U5: assisted stepping', () => {
	test('dragging q0 to d0 arms q1 to d1 until Escape', async ({ page }) => {
		const email = uniqueEmail('assist');
		await createVerifiedAccount(page, email);
		const project = await apiCreateProject(page, 'assist-step', seedDocument());
		const projectId = String(project['id']);
		await page.goto(`/projects/${projectId}`);
		await expect(page.getByTestId('component-count')).toHaveText('2 components');

		const box = (await page.locator('.canvas-slot canvas').boundingBox())!;
		// Wait until canvas hit-testing is live: click r1's body until selected.
		const body = toScreen(box, { x: 120 + 32, y: 200 + 141 });
		await clickUntilSelected(page, body.x, body.y);
		await dragWire(page, box, Q0, D0);

		// q0 and d0 share a net; the assist arms q1 to d1.
		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');
		const doc = await apiGetProject(page, projectId);
		const components = doc.document?.circuit?.components as Array<{
			id: string;
			inputs: Record<string, string>;
			outputs: Record<string, string>;
		}>;
		const r1 = components.find((c) => c.id === 'r1')!;
		const r2 = components.find((c) => c.id === 'r2')!;
		expect(r1.outputs['q0']).toBeDefined();
		expect(r2.inputs['d0']).toBe(r1.outputs['q0']);
		await expect(page.locator('.hint')).toContainText('Next q1 → d1');

		// A mismatched connection arms nothing: wire q2 to d5 instead.
		const q2 = { x: 120 + 64, y: 200 + (282 * 3) / 17 };
		const d5 = { x: 500, y: 200 + (282 * 7) / 18 };
		await dragWire(page, box, q2, d5);
		await expect(page.locator('.hint')).toContainText('Drag pins to wire');

		await page.keyboard.press('Escape');
		await expect(page.locator('.hint')).toContainText('Drag pins to wire');
	});
});
