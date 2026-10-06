import { readFile, writeFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import {
	apiCreateProject,
	apiGetProject,
	apiSaveProject,
	createVerifiedAccount,
	uniqueEmail
} from './helpers';
import { loadFixture } from './logic';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const UUID_PATTERN = /\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface CircuitShape {
	domain?: string;
	models?: unknown[];
	analyses?: { id: string; kind: string; params?: Record<string, unknown> }[];
}

function circuitOf(document: unknown): CircuitShape {
	return (document as { circuit: CircuitShape }).circuit;
}

function analysisById(document: unknown, id: string) {
	return circuitOf(document).analyses?.find((entry) => entry.id === id);
}

function analysisNames(document: unknown): string[] {
	return (circuitOf(document).analyses ?? []).map((entry) => String(entry.params?.['name'] ?? ''));
}

async function waitForLive(page: Page): Promise<void> {
	await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-status', 'connected', {
		timeout: 15_000
	});
}

async function runAnalogAndWait(page: Page): Promise<void> {
	await page.getByTestId('analog-run').click();
	await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
		timeout: 60_000
	});
}

test.describe('analog project lifecycle', () => {
	test.describe.configure({ timeout: 180_000 });

	test('creating an analog project opens the analog surface while a logic project stays digital', async ({
		page
	}) => {
		await createVerifiedAccount(page, uniqueEmail('lifecycle-create'));
		await page.goto('/projects');

		await page.getByPlaceholder('New project name').fill('lifecycle-analog');
		await page.getByTestId('new-project-domain').selectOption('analog');
		await page.getByTestId('create-project').click();
		await expect(page).toHaveURL(UUID_PATTERN);
		await expect(page.getByTestId('analysis-panel')).toBeVisible();
		await expect(page.getByTestId('analog-run')).toBeVisible();
		await expect(page.getByTestId('simulation-panel')).toHaveCount(0);

		await page.goto('/projects');
		const analogRow = page.getByTestId('project-row').filter({ hasText: 'lifecycle-analog' });
		await expect(analogRow).toBeVisible();
		await expect(analogRow.getByTestId('project-domain')).toHaveText('analog');

		await page.getByPlaceholder('New project name').fill('lifecycle-logic');
		await page.getByTestId('new-project-domain').selectOption('logic');
		await page.getByTestId('create-project').click();
		await expect(page).toHaveURL(UUID_PATTERN);
		await expect(page.getByTestId('simulation-panel')).toBeVisible();
		await expect(page.getByTestId('analysis-panel')).toHaveCount(0);

		await page.goto('/projects');
		const logicRow = page.getByTestId('project-row').filter({ hasText: 'lifecycle-logic' });
		await expect(logicRow).toBeVisible();
		await expect(logicRow.getByTestId('project-domain')).toHaveText('logic');
	});

	test('import restores the exported analog document, and the chooser only fills an absent domain', async ({
		page
	}, testInfo) => {
		await createVerifiedAccount(page, uniqueEmail('lifecycle-import'));
		const source = await loadFixture('analog-u6-rc.json');
		const created = await apiCreateProject(page, 'lifecycle-import-source', source);
		const projectId = String(created['id']);

		await page.goto(`/projects/${projectId}`);
		await expect(page.getByTestId('analysis-panel')).toBeVisible();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('export-project').click()
		]);
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const envelope = JSON.parse(await readFile(downloadedPath!, 'utf8')) as {
			document: unknown;
		};

		await page.goto('/projects');
		await page.getByTestId('new-project-domain').selectOption('logic');
		await page.getByTestId('import-file').setInputFiles(downloadedPath!);
		await expect(page).toHaveURL(UUID_PATTERN);
		await expect(page.getByTestId('analysis-panel')).toBeVisible();
		const declaredId = page.url().split('/').pop()!;
		const declared = await apiGetProject(page, declaredId);
		expect(circuitOf(declared['document']).domain).toBe('analog');
		expect(circuitOf(declared['document']).models).toEqual(circuitOf(source).models);
		expect(circuitOf(declared['document']).analyses).toEqual(circuitOf(source).analyses);

		await page.goto('/projects');
		await expect(
			page
				.getByTestId('project-row')
				.filter({ hasText: 'lifecycle-import-source' })
				.getByTestId('project-domain')
				.first()
		).toHaveText('analog');

		const stripped = JSON.parse(JSON.stringify(envelope)) as {
			document: { circuit: Record<string, unknown> };
		};
		delete stripped.document.circuit['domain'];
		const strippedPath = testInfo.outputPath('stripped-analog-project.json');
		await writeFile(strippedPath, JSON.stringify(stripped), 'utf8');

		await page.getByTestId('new-project-domain').selectOption('analog');
		await page.getByTestId('import-file').setInputFiles(strippedPath);
		await expect(page).toHaveURL(UUID_PATTERN);
		const filledId = page.url().split('/').pop()!;
		const filled = await apiGetProject(page, filledId);
		expect(circuitOf(filled['document']).domain).toBe('analog');
		expect(circuitOf(filled['document']).models).toEqual(circuitOf(source).models);
		expect(circuitOf(filled['document']).analyses).toEqual(circuitOf(source).analyses);
		await expect(page.getByTestId('analysis-panel')).toBeVisible();
	});

	test('a read-only teammate can run analyses while analysis edits and model import stay blocked', async ({
		browser
	}) => {
		const ownerEmail = uniqueEmail('lifecycle-owner');
		const memberEmail = uniqueEmail('lifecycle-member');
		const teamName = `LC-${Date.now()}`;
		const ownerContext = await browser.newContext({ baseURL: BASE_URL });
		const memberContext = await browser.newContext({ baseURL: BASE_URL });
		const owner = await ownerContext.newPage();
		const member = await memberContext.newPage();

		try {
			await createVerifiedAccount(owner, ownerEmail);
			await createVerifiedAccount(member, memberEmail);

			const fixture = await loadFixture('analog-u6-rc.json');
			const project = await apiCreateProject(owner, 'lifecycle-shared-analog', fixture);
			const projectId = String(project['id']);

			await owner.goto('/teams');
			await owner.getByPlaceholder('New team name').fill(teamName);
			await owner.getByTestId('create-team').click();
			const teamRow = owner.getByTestId('team-row').filter({ hasText: teamName });
			await expect(teamRow).toBeVisible();
			await teamRow.getByTestId('team-name').click();
			await owner.getByPlaceholder('Member email').fill(memberEmail);
			await owner.getByTestId('add-member').click();
			await expect(owner.getByTestId('member-row').filter({ hasText: memberEmail })).toBeVisible();

			await owner.goto(`/projects/${projectId}`);
			await waitForLive(owner);
			await expect(owner.getByTestId('lock-banner')).toHaveAttribute('data-role', 'holder');
			await owner.getByTestId('share-project').click();
			const dialog = owner.getByTestId('share-dialog');
			await expect(dialog).toBeVisible();
			await owner.getByTestId('share-team-select').selectOption({ label: teamName });
			await owner.getByTestId('share-add').click();
			await expect(dialog.getByTestId('share-row').filter({ hasText: teamName })).toBeVisible();
			await owner.getByTestId('share-close').click();

			await member.goto('/projects');
			const sharedRow = member.getByTestId('project-row').filter({ hasText: 'lifecycle-shared-analog' });
			await expect(sharedRow).toBeVisible();
			await sharedRow.getByTestId('project-name').click();
			await expect(member).toHaveURL(UUID_PATTERN);
			await waitForLive(member);
			await expect(member.getByTestId('lock-busy')).toContainText(ownerEmail, { timeout: 15_000 });

			await expect(member.getByTestId('analysis-panel')).toBeVisible();
			await expect(member.getByTestId('analysis-readonly')).toBeVisible();
			await expect(member.getByTestId('analog-run')).toBeEnabled();
			await runAnalogAndWait(member);
			await expect(member.getByTestId('analysis-result')).toHaveCount(3);

			await expect(member.getByTestId('analysis-tran-duration')).toBeDisabled();
			await expect(member.getByTestId('analysis-ac-start')).toBeDisabled();
			await expect(member.getByTestId('measurement-add')).toBeDisabled();
			await expect(member.getByTestId('measurement-name').first()).toBeDisabled();
			await expect(member.getByTestId('measurement-remove').first()).toBeDisabled();

			const importControl = member.getByTestId('import-model');
			if ((await importControl.count()) > 0) {
				await expect(importControl).toBeDisabled();
			}
		} finally {
			await ownerContext.close();
			await memberContext.close();
		}
	});

	test('a lock conflict with a dirty analog project keeps the draft through export and save-as-copy', async ({
		page
	}) => {
		await createVerifiedAccount(page, uniqueEmail('lifecycle-conflict'));
		const source = await loadFixture('analog-divider-project.json');
		const project = await apiCreateProject(page, 'lifecycle-conflict-source', source);
		const projectId = String(project['id']);

		await page.goto(`/projects/${projectId}`);
		await expect(page.getByTestId('analysis-panel')).toBeVisible();
		await expect(page.getByTestId('lock-banner')).toHaveAttribute('data-role', 'holder');

		await page.getByTestId('analysis-tran-duration').fill('2m');
		await page.getByTestId('measurement-add').click();
		const measurementRow = page.getByTestId('measurement-row').last();
		await measurementRow.getByTestId('measurement-name').fill('draft-measure');

		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');
		const dirtySaved = await apiGetProject(page, projectId);
		expect(circuitOf(dirtySaved['document']).domain).toBe('analog');
		expect(circuitOf(dirtySaved['document']).models).toHaveLength(2);
		expect(analysisById(dirtySaved['document'], 'tran1')?.params?.['duration']).toBe(0.002);
		expect(analysisNames(dirtySaved['document'])).toContain('draft-measure');

		const bumped = await apiSaveProject(page, projectId, 'lifecycle-conflict-source', 2, source);
		expect(bumped.status()).toBe(200);
		await page.getByTestId('analysis-tran-maxstep').fill('2u');
		await page.getByTestId('save-project').click();
		const conflictPanel = page.getByTestId('conflict-panel');
		await expect(conflictPanel).toBeVisible();

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			conflictPanel.getByRole('button', { name: 'Export local copy' }).click()
		]);
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const envelope = JSON.parse(await readFile(downloadedPath!, 'utf8')) as { document: unknown };
		expect(circuitOf(envelope.document).domain).toBe('analog');
		expect(circuitOf(envelope.document).models).toHaveLength(2);
		expect(analysisById(envelope.document, 'tran1')?.params?.['duration']).toBe(0.002);
		expect(analysisById(envelope.document, 'tran1')?.params?.['maxStep']).toBe(0.000002);
		expect(analysisNames(envelope.document)).toContain('draft-measure');

		await conflictPanel.getByRole('button', { name: 'Save as copy' }).click();
		await expect(page).toHaveURL((url) => url.pathname !== `/projects/${projectId}`);
		await expect(page.getByLabel('Project name')).toHaveValue('lifecycle-conflict-source (copy)');
		const copyId = page.url().split('/').pop()!;
		const copy = await apiGetProject(page, copyId);
		expect(circuitOf(copy['document']).domain).toBe('analog');
		expect(circuitOf(copy['document']).models).toHaveLength(2);
		expect(analysisById(copy['document'], 'tran1')?.params?.['duration']).toBe(0.002);
		expect(analysisById(copy['document'], 'tran1')?.params?.['maxStep']).toBe(0.000002);
		expect(analysisNames(copy['document'])).toContain('draft-measure');
	});
});
