import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { apiGetProject } from './helpers';
import { openFixture } from './logic';

function circuitOf(value: unknown): Record<string, unknown> {
	return (value as { circuit: Record<string, unknown> }).circuit;
}

function sectionsOf(value: unknown): Record<string, unknown> {
	const circuit = circuitOf(value);
	return {
		domain: circuit['domain'],
		models: circuit['models'],
		analyses: circuit['analyses']
	};
}

test.describe('analog export/import round-trip', () => {
	test('an analog project keeps domain, models, and analyses through save, export, and import', async ({
		page
	}) => {
		const { projectId, document } = await openFixture(page, 'analog-divider-project.json', {
			emailPrefix: 'analog-divider',
			projectName: 'analog-divider-source'
		});
		const expected = sectionsOf(document);
		expect(expected['domain']).toBe('analog');
		await expect(page.getByTestId('component-count')).not.toHaveText('0 components');

		const initial = await apiGetProject(page, projectId);
		expect(sectionsOf(initial['document'])).toEqual(expected);

		await expect(page.getByTestId('save-project')).toBeEnabled();
		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');
		const saved = await apiGetProject(page, projectId);
		expect(sectionsOf(saved['document'])).toEqual(expected);

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('export-project').click()
		]);
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const envelope = JSON.parse(await readFile(downloadedPath!, 'utf8')) as {
			format: string;
			document: unknown;
		};
		expect(envelope.format).toBe('circuitgate-project');
		expect(envelope.document).toEqual(saved['document']);

		await page.goto('/projects');
		await page.getByTestId('import-file').setInputFiles(downloadedPath!);
		await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
		const importedId = page.url().split('/').pop()!;
		await expect(page.getByTestId('component-count')).not.toHaveText('0 components');
		const imported = await apiGetProject(page, importedId);
		expect(imported['document']).toEqual(saved['document']);
	});

	test('an RC analog project round-trips its analyses and models through export', async ({ page }) => {
		const { projectId, document } = await openFixture(page, 'analog-rc-project.json', {
			emailPrefix: 'analog-rc',
			projectName: 'analog-rc-source'
		});
		const expected = sectionsOf(document);
		expect(expected['domain']).toBe('analog');
		expect(expected['models']).toHaveLength(2);
		expect(expected['analyses']).toHaveLength(3);

		const initial = await apiGetProject(page, projectId);
		expect(sectionsOf(initial['document'])).toEqual(expected);

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('export-project').click()
		]);
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const envelope = JSON.parse(await readFile(downloadedPath!, 'utf8')) as { document: unknown };
		expect(sectionsOf(envelope.document)).toEqual(expected);
	});
});
