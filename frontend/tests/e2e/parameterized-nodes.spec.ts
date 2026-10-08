import { expect, test, type Page } from '@playwright/test';

import { apiCreateProject, apiGetProject, createVerifiedAccount, uniqueEmail } from './helpers';

// U4: palette, Inspector, and symbols for the six parameterized families.
// Placement goes through the palette buttons (registered-kind filter), edits
// go through the Inspector width/contents controls with inline validation.

const FAMILIES = [
	'rippleCarryAdder',
	'magnitudeComparator',
	'register',
	'registerFile',
	'ram',
	'rom'
] as const;

const DEFAULT_PARAMS: Record<string, Record<string, unknown>> = {
	rippleCarryAdder: { width: 8 },
	magnitudeComparator: { width: 8 },
	register: { width: 8 },
	registerFile: { addressBits: 4, wordBits: 8 },
	ram: { addressBits: 4, wordBits: 8 },
	rom: { wordBits: 8, contents: new Array(16).fill(0) }
};

function emptyDocument(): Record<string, unknown> {
	return {
		circuit: { schemaVersion: 1, components: [] },
		definitions: {},
		layouts: { '': {} }
	};
}

async function openEmptyProject(page: Page, tag: string): Promise<string> {
	const email = uniqueEmail(`param-${tag}`);
	await createVerifiedAccount(page, email);
	const project = await apiCreateProject(page, `param-${tag}`, emptyDocument());
	const projectId = String(project['id']);
	await page.goto(`/projects/${projectId}`);
	await expect(page.getByTestId('component-count')).toHaveText('0 components');
	return projectId;
}

async function placeAt(page: Page, kind: string, dx: number, dy: number): Promise<void> {
	await page.getByRole('button', { name: kind, exact: true }).click();
	await expect(page.getByText(`Click to place ${kind}`)).toBeVisible();
	// Locator position clicks scroll into view, so below-the-fold palette
	// buttons cannot push the canvas box off-viewport mid-click.
	await page.locator('.canvas-slot canvas').click({ position: { x: dx, y: dy } });
}

async function saveProject(page: Page): Promise<void> {
	await page.getByTestId('save-project').click();
	await expect(page.getByTestId('save-status')).toHaveText('Saved');
}

async function placeAndSelect(page: Page, kind: string, dx: number, dy: number): Promise<void> {
	await placeAt(page, kind, dx, dy);
	// Placement consumes the pending kind; a second click selects the node.
	await page.locator('.canvas-slot canvas').click({ position: { x: dx, y: dy } });
}

async function fillAndCommit(page: Page, testId: string, text: string): Promise<void> {
	const input = page.getByTestId(testId);
	await expect(input).toBeVisible();
	await input.fill(text);
	await input.blur();
}

test.describe('U4: parameterized logic nodes in palette and Inspector', () => {
	test('all six palette entries place nodes with KTD5 defaults', async ({ page }) => {
		const projectId = await openEmptyProject(page, 'palette');
		const palette = page.locator('.palette');
		await expect(palette).toHaveAttribute('data-domain', 'logic');

		const spots: Array<[number, number]> = [
			[180, 140],
			[420, 140],
			[660, 140],
			[180, 360],
			[420, 360],
			[660, 360]
		];
		for (let index = 0; index < FAMILIES.length; index += 1) {
			const kind = FAMILIES[index];
			await expect(palette.getByRole('button', { name: kind, exact: true })).toBeVisible();
			const [dx, dy] = spots[index];
			await placeAt(page, kind, dx, dy);
			await expect(page.getByTestId('component-count')).toHaveText(
				`${index + 1} components`
			);
		}

		await saveProject(page);
		const saved = await apiGetProject(page, projectId);
		const components = (
			saved['document'] as { circuit: { components: Array<{ kind: string; params?: unknown }> } }
		).circuit.components;
		expect(components).toHaveLength(6);
		for (const kind of FAMILIES) {
			const match = components.find((component) => component.kind === kind);
			expect(match, `placed ${kind}`).toBeDefined();
			expect(match?.params).toEqual(DEFAULT_PARAMS[kind]);
		}
	});

	test('bus width edits accept 1-32 and reject 0, non-integers, and widths above 32', async ({
		page
	}) => {
		await openEmptyProject(page, 'width');
		await placeAndSelect(page, 'register', 260, 180);

		const width = page.getByTestId('width-input');
		await expect(width).toBeVisible();
		await expect(width).toHaveValue('8');

		for (const valid of ['1', '16', '32']) {
			await fillAndCommit(page, 'width-input', valid);
			await expect(page.getByTestId('width-error')).toHaveCount(0);
			await expect(width).toHaveValue(valid);
		}

		// magnitudeComparator exposes the same width control.
		await placeAndSelect(page, 'magnitudeComparator', 520, 180);
		await expect(page.getByTestId('width-input')).toBeVisible();

		// Rejections retain the invalid text for correction and never clamp.
		for (const invalid of ['0', '2.5', 'abc', '33']) {
			await fillAndCommit(page, 'width-input', invalid);
			const error = page.getByTestId('width-error');
			await expect(error).toBeVisible();
			await expect(error).toContainText('1');
			await expect(error).toContainText('32');
			await expect(page.getByTestId('width-input')).toHaveValue(invalid);
		}
		// 33 is rejected, not clamped to 32.
		await fillAndCommit(page, 'width-input', '8');
		await expect(page.getByTestId('width-error')).toHaveCount(0);
		await expect(page.getByTestId('width-input')).toHaveValue('8');
	});

	test('invalid ROM contents show an inline message and are not committed', async ({ page }) => {
		const projectId = await openEmptyProject(page, 'rom');
		await placeAndSelect(page, 'rom', 260, 180);

		await expect(page.getByTestId('rom-depth')).toHaveText('Depth: 16 words (4 address bits)');
		await expect(page.getByTestId('wordbits-input')).toHaveValue('8');

		await fillAndCommit(page, 'contents-input', 'not json');
		await expect(page.getByTestId('contents-error')).toContainText('valid JSON');

		await fillAndCommit(page, 'contents-input', '[0, 1, 2]');
		await expect(page.getByTestId('contents-error')).toContainText('power of two');

		await fillAndCommit(page, 'contents-input', '[0, 1, 2, 300]');
		await expect(page.getByTestId('contents-error')).toContainText('does not fit in 8 bits');

		// None of the invalid edits committed: depth still derives from sixteen zeros.
		await expect(page.getByTestId('rom-depth')).toHaveText('Depth: 16 words (4 address bits)');

		await fillAndCommit(page, 'contents-input', '[0, 1, 2, 3]');
		await expect(page.getByTestId('contents-error')).toHaveCount(0);
		await expect(page.getByTestId('rom-depth')).toHaveText('Depth: 4 words (2 address bits)');

		await saveProject(page);
		const saved = await apiGetProject(page, projectId);
		const components = (
			saved['document'] as { circuit: { components: Array<{ kind: string; params?: unknown }> } }
		).circuit.components;
		expect(components.find((component) => component.kind === 'rom')?.params).toEqual({
			wordBits: 8,
			contents: [0, 1, 2, 3]
		});
	});

	test('RAM address width and word width edit independently', async ({ page }) => {
		await openEmptyProject(page, 'ram');
		await placeAndSelect(page, 'ram', 260, 180);

		const word = page.getByTestId('wordbits-input');
		const address = page.getByTestId('addressbits-input');
		await expect(word).toHaveValue('8');
		await expect(address).toHaveValue('4');

		await fillAndCommit(page, 'addressbits-input', '2');
		await expect(page.getByTestId('addressbits-error')).toHaveCount(0);
		await expect(address).toHaveValue('2');
		await expect(word).toHaveValue('8');

		await fillAndCommit(page, 'wordbits-input', '4');
		await expect(page.getByTestId('wordbits-error')).toHaveCount(0);
		await expect(word).toHaveValue('4');
		await expect(address).toHaveValue('2');

		await fillAndCommit(page, 'addressbits-input', '0');
		await expect(page.getByTestId('addressbits-error')).toBeVisible();
		await expect(address).toHaveValue('0');

		// Register files expose the same independent pair.
		await placeAndSelect(page, 'registerFile', 520, 200);
		await expect(page.getByTestId('wordbits-input')).toHaveValue('8');
		await expect(page.getByTestId('addressbits-input')).toHaveValue('4');
	});

	test('shrinking a wired node surfaces the dropped-net count until the next change', async ({
		page
	}) => {
		const email = uniqueEmail('param-shrink');
		await createVerifiedAccount(page, email);
		const project = await apiCreateProject(page, 'param-shrink', {
			circuit: {
				schemaVersion: 1,
				components: [
					{
						id: 'reg1',
						kind: 'register',
						params: { width: 16 },
						inputs: { clk: 'CLK', d0: 'D0', d14: 'D14', d15: 'D15' },
						outputs: { q0: 'Q0', q14: 'Q14', q15: 'Q15' }
					}
				]
			},
			definitions: {},
			layouts: { '': { reg1: { position: { x: 160, y: 120 } } } }
		});
		await page.goto(`/projects/${String(project['id'])}`);
		await expect(page.getByTestId('component-count')).toHaveText('1 components');

		// Default viewport maps world (x, y) to canvas offset (x + 48, y + 48);
		// the 16-bit register at (160, 120) is 64 wide and 282 tall.
		await page.locator('.canvas-slot canvas').click({ position: { x: 160 + 48 + 32, y: 120 + 48 + 141 } });
		await expect(page.getByTestId('width-input')).toHaveValue('16');

		await fillAndCommit(page, 'width-input', '8');
		await expect(page.getByTestId('width-error')).toHaveCount(0);
		await expect(page.getByTestId('param-notice')).toHaveText('4 nets disconnected by this change.');

		// The next parameter edit clears the notice.
		await fillAndCommit(page, 'width-input', '4');
		await expect(page.getByTestId('param-notice')).toHaveCount(0);
	});
});
