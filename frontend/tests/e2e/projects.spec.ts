import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
	apiCreateProject,
	apiGetProject,
	apiSaveProject,
	createVerifiedAccount,
	csrfHeaders,
	placeComponent,
	seededDocument,
	TEST_PASSWORD,
	uniqueEmail
} from './helpers';

const UUID_PATTERN = /\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.describe('project persistence', () => {
	test('create a project, save an edit, and reload identical content', async ({ page }) => {
		const email = uniqueEmail('projects-save');
		await createVerifiedAccount(page, email);

		await page.goto('/projects');
		await page.getByPlaceholder('New project name').fill('save-reload');
		await page.getByTestId('create-project').click();
		await expect(page).toHaveURL(UUID_PATTERN);
		await expect(page.getByTestId('component-count')).toHaveText('0 components');

		await placeComponent(page, 'and');
		await expect(page.getByTestId('component-count')).toHaveText('1 components');

		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');

		await page.reload();
		await expect(page.getByTestId('component-count')).toHaveText('1 components');
		await expect(page.getByRole('button', { name: 'and', exact: true })).toBeVisible();
	});

	test('a stale save keeps the local buffer and offers view-latest, save-as-copy, and export', async ({
		page
	}) => {
		const email = uniqueEmail('projects-stale');
		await createVerifiedAccount(page, email);
		const project = await apiCreateProject(page, 'stale-project', {
			circuit: { schemaVersion: 1, components: [] },
			definitions: {},
			layouts: { '': {} }
		});
		const projectId = String(project['id']);

		await page.goto(`/projects/${projectId}`);
		await expect(page.getByTestId('component-count')).toHaveText('0 components');

		const bumped = await apiSaveProject(page, projectId, 'stale-project', 1, {
			circuit: { schemaVersion: 1, components: [] },
			definitions: {},
			layouts: { '': {} }
		});
		expect(bumped.status()).toBe(200);

		await placeComponent(page, 'and');
		await expect(page.getByTestId('component-count')).toHaveText('1 components');
		await page.getByTestId('save-project').click();

		const conflict = page.getByTestId('conflict-panel');
		await expect(conflict).toBeVisible();
		await expect(conflict.getByRole('button', { name: 'View latest' })).toBeVisible();
		await expect(conflict.getByRole('link', { name: 'Open latest in new tab' })).toBeVisible();
		await expect(conflict.getByRole('button', { name: 'Save as copy' })).toBeVisible();
		await expect(conflict.getByRole('button', { name: 'Export local copy' })).toBeVisible();
		await expect(page.getByTestId('component-count')).toHaveText('1 components');

		await conflict.getByRole('button', { name: 'View latest' }).click();
		await expect(page.getByTestId('latest-summary')).toContainText('version 2 with 0 components');

		const original = await apiGetProject(page, projectId);
		expect((original['document'] as { circuit: { components: unknown[] } }).circuit.components).toHaveLength(0);

		await conflict.getByRole('button', { name: 'Save as copy' }).click();
		await expect(page).toHaveURL(UUID_PATTERN);
		await expect(page.getByTestId('component-count')).toHaveText('1 components');
	});

	test('export downloads the document and import creates an equivalent project', async ({ page }) => {
		const email = uniqueEmail('projects-export');
		await createVerifiedAccount(page, email);
		const project = await apiCreateProject(page, 'export-source', seededDocument());
		const projectId = String(project['id']);

		await page.goto(`/projects/${projectId}`);
		await expect(page.getByTestId('component-count')).toHaveText('2 components');

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('export-project').click()
		]);
		expect(download.suggestedFilename()).toMatch(/\.circuitgate\.json$/);
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const envelope = JSON.parse(await readFile(downloadedPath!, 'utf8')) as {
			format: string;
			document: unknown;
		};
		expect(envelope.format).toBe('circuitgate-project');
		expect(envelope.document).toEqual(seededDocument());

		await page.goto('/projects');
		await page.getByTestId('import-file').setInputFiles(downloadedPath!);
		await expect(page).toHaveURL(UUID_PATTERN);

		const importedId = page.url().split('/').pop()!;
		const imported = await apiGetProject(page, importedId);
		expect(imported['name']).toBe('export-source');
		expect(imported['document']).toEqual(seededDocument());
		await expect(page.getByTestId('component-count')).toHaveText('2 components');
	});

	test('a save that returns unauthenticated keeps the document through re-authentication', async ({
		page
	}) => {
		const email = uniqueEmail('projects-reauth');
		await createVerifiedAccount(page, email);
		const project = await apiCreateProject(page, 'reauth-project', {
			circuit: { schemaVersion: 1, components: [] },
			definitions: {},
			layouts: { '': {} }
		});
		const projectId = String(project['id']);

		await page.goto(`/projects/${projectId}`);
		await placeComponent(page, 'and');
		await expect(page.getByTestId('component-count')).toHaveText('1 components');

		const headers = await csrfHeaders(page);
		const loggedOut = await page.context().request.post('/api/auth/logout', { headers });
		expect(loggedOut.status()).toBe(204);

		await page.getByTestId('save-project').click();
		const reauthPanel = page.getByTestId('reauth-panel');
		await expect(reauthPanel).toBeVisible();
		await expect(page.getByTestId('component-count')).toHaveText('1 components');

		await reauthPanel.getByLabel('Password').fill(TEST_PASSWORD);
		await reauthPanel.getByRole('button', { name: 'Sign in and save' }).click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');
		await expect(reauthPanel).toBeHidden();

		const saved = await apiGetProject(page, projectId);
		expect((saved['document'] as { circuit: { components: unknown[] } }).circuit.components).toHaveLength(1);
	});

	test('HTML and control characters in metadata render as inert text', async ({ page }) => {
		const email = uniqueEmail('projects-inert');
		await createVerifiedAccount(page, email);
		const hostileName = `<img src=x onerror="window.__xss=1"> \u0007 \u001b[31mred`;
		await apiCreateProject(page, hostileName, seededDocument());

		let dialogSeen = false;
		page.on('dialog', async (dialog) => {
			dialogSeen = true;
			await dialog.dismiss();
		});

		await page.goto('/projects');
		const nameCell = page.getByTestId('project-name').first();
		await expect(nameCell).toBeVisible();
		expect(await nameCell.textContent()).toBe(hostileName);
		expect(await page.locator('.project-list img').count()).toBe(0);
		expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

		await nameCell.click();
		await expect(page).toHaveURL(UUID_PATTERN);
		await expect(page.getByLabel('Project name')).toHaveValue(hostileName);
		expect(dialogSeen).toBe(false);
	});
});
