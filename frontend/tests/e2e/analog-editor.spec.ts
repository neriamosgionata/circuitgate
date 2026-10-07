import { expect, test } from '@playwright/test';

import { placeComponent } from './helpers';
import { openFixture } from './logic';

test.describe('analog editor', () => {
	test('offers only analog kinds in an analog project and places them', async ({ page }) => {
		await openFixture(page, 'analog-divider-project.json', {
			emailPrefix: 'analog-editor',
			projectName: 'analog-editor-source'
		});

		const palette = page.locator('.palette');
		await expect(palette).toHaveAttribute('data-domain', 'analog');
		await expect(palette.getByRole('button', { name: 'resistor', exact: true })).toBeVisible();
		await expect(palette.getByRole('button', { name: 'ground', exact: true })).toBeVisible();
		await expect(palette.getByRole('button', { name: 'timer555', exact: true })).toBeVisible();
		await expect(palette.getByRole('button', { name: 'and', exact: true })).toHaveCount(0);
		await expect(palette.getByRole('button', { name: 'probe', exact: true })).toHaveCount(0);
		await expect(page.getByText('Passives')).toBeVisible();

		await expect(page.getByTestId('component-count')).toHaveText(/4 components/);
		await placeComponent(page, 'capacitor');
		await expect(page.getByTestId('component-count')).toHaveText(/5 components/);
	});

	test('offers no analog kinds in a logic project', async ({ page }) => {
		await openFixture(page, 'sr-latch-project.json', {
			emailPrefix: 'logic-editor',
			projectName: 'logic-editor-source'
		});

		const palette = page.locator('.palette');
		await expect(palette).toHaveAttribute('data-domain', 'logic');
		await expect(palette.getByRole('button', { name: 'clock', exact: true })).toBeVisible();
		await expect(palette.getByRole('button', { name: 'resistor', exact: true })).toHaveCount(0);
		await expect(palette.getByRole('button', { name: 'ground', exact: true })).toHaveCount(0);
	});

	test('rejects ambiguous analog values inline and saves valid SI values', async ({ page }) => {
		await openFixture(page, 'analog-divider-project.json', {
			emailPrefix: 'analog-editor-si',
			projectName: 'analog-editor-si'
		});

		await placeComponent(page, 'resistor');
		const canvas = page.locator('.canvas-slot canvas');
		const box = await canvas.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.click(box!.x + 260, box!.y + 180);
		const input = page.getByTestId('param-resistance');
		await expect(input).toBeVisible();

		await input.fill('1M');
		await input.blur();
		await expect(page.getByTestId('param-error')).toBeVisible();

		await input.fill('2.2k');
		await input.blur();
		await expect(page.getByTestId('param-error')).toHaveCount(0);
		await expect(input).toHaveValue('2200');
	});
});
