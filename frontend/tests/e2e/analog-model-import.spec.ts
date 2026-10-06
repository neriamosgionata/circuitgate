import { readFile, writeFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { apiCreateProject, apiGetProject, createVerifiedAccount, uniqueEmail } from './helpers';

/**
 * U8 SPICE model import: the dialog stores only parsed-and-accepted models,
 * canonical re-emission keeps raw text out of the deck, the worker repeats
 * validation on every run, and an imported model survives save/export/import
 * and still simulates (AE5, AE6, KTD6).
 */

const VENDOR_OPAMP = `* Vendor-style op-amp macromodel
.SUBCKT vendoropamp inp inn vcc vee out
+ params: gain=100000
rin\tinp   inn 1meg ; input resistance
eout out 0 inp inn {gain}
.ENDS VENDOROPAMP`;

const WASM_PATTERN = /ngspice.*\.wasm/;
const UUID_PATTERN = /\/projects\/[0-9a-f-]{36}$/;

function baseDocument(components: unknown[], models: unknown[]) {
	return {
		circuit: {
			schemaVersion: 1,
			domain: 'analog',
			components,
			models,
			analyses: [{ id: 'op1', kind: 'op', params: {} }]
		},
		definitions: {},
		layouts: {}
	};
}

function rcDocument(models: unknown[] = []) {
	return baseDocument(
		[
			{
				id: 'v1',
				kind: 'vsource',
				inputs: {},
				outputs: { p2: 'vin' },
				params: { waveform: 'dc', voltage: 5 }
			},
			{
				id: 'r1',
				kind: 'resistor',
				inputs: { p1: 'vin' },
				outputs: { p2: 'vout' },
				params: { resistance: 1000 }
			},
			{
				id: 'r2',
				kind: 'resistor',
				inputs: { p1: 'vout' },
				outputs: { p2: '0' },
				params: { resistance: 1000 }
			},
			{ id: 'g1', kind: 'ground', inputs: { p1: '0' }, outputs: {} }
		],
		models
	);
}

function opampFollowerDocument() {
	return baseDocument(
		[
			{ id: 'g1', kind: 'ground', inputs: { p1: '0' }, outputs: {} },
			{
				id: 'vcc',
				kind: 'vsource',
				inputs: {},
				outputs: { p2: 'vcc' },
				params: { waveform: 'dc', voltage: 12 }
			},
			{
				id: 'vee',
				kind: 'vsource',
				inputs: {},
				outputs: { p2: 'vee' },
				params: { waveform: 'dc', voltage: -12 }
			},
			{
				id: 'vin',
				kind: 'vsource',
				inputs: {},
				outputs: { p2: 'inp' },
				params: { waveform: 'dc', voltage: 1 }
			},
			{
				id: 'x1',
				kind: 'opamp',
				inputs: { inp: 'inp', inn: 'out', vcc: 'vcc', vee: 'vee' },
				outputs: { out: 'out' },
				params: { model: 'vendoropamp' }
			},
			{
				id: 'rl',
				kind: 'resistor',
				inputs: { p1: 'out' },
				outputs: { p2: '0' },
				params: { resistance: 10000 }
			}
		],
		[]
	);
}

function circuitModels(document: unknown): { name: string; formatVersion: number; source: string }[] {
	return (document as { circuit: { models: { name: string; formatVersion: number; source: string }[] } })
		.circuit.models;
}

async function openImportDialog(page: Page) {
	await page.getByTestId('import-model').click();
	const dialog = page.getByTestId('import-model-dialog');
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe('analog model import', () => {
	test.describe.configure({ timeout: 180_000 });

	test('imports a vendor-style subckt, simulates, and survives save/export/import (AE5)', async ({
		page
	}) => {
		await createVerifiedAccount(page, uniqueEmail('analog-import-ae5'));
		const created = await apiCreateProject(page, 'import-opamp', opampFollowerDocument());
		const projectId = String(created['id']);
		await page.goto(`/projects/${projectId}`);
		await expect(page.getByTestId('analysis-panel')).toBeVisible();

		const dialog = await openImportDialog(page);
		await dialog.getByTestId('import-model-text').fill(VENDOR_OPAMP);
		await dialog.getByTestId('import-model-submit').click();
		await expect(dialog.getByTestId('import-model-success')).toContainText('vendoropamp');
		await dialog.getByTestId('import-model-cancel').click();

		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');
		const saved = await apiGetProject(page, projectId);
		const models = circuitModels(saved['document']);
		expect(models).toHaveLength(1);
		expect(models[0].name).toBe('vendoropamp');
		expect(models[0].formatVersion).toBe(1);
		expect(models[0].source).toContain('vendoropamp');

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		const opResult = page.locator('[data-testid="analysis-result"][data-analysis-id="op1"]');
		await expect(opResult).toHaveAttribute('data-status', 'complete');

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('export-project').click()
		]);
		const downloadedPath = await download.path();
		expect(downloadedPath).not.toBeNull();
		const envelope = JSON.parse(await readFile(downloadedPath!, 'utf8')) as { document: unknown };
		expect(circuitModels(envelope.document)).toEqual(models);

		await page.goto('/projects');
		await page.getByTestId('import-file').setInputFiles(downloadedPath!);
		await expect(page).toHaveURL(UUID_PATTERN);
		const importedId = page.url().split('/').pop()!;
		const imported = await apiGetProject(page, importedId);
		expect(circuitModels(imported['document'])).toEqual(models);
		expect(circuitModels(imported['document'])[0].source).toBe(VENDOR_OPAMP);

		await page.getByTestId('analog-run').click();
		await expect(page.getByTestId('analog-run-status')).toHaveText('complete', {
			timeout: 60_000
		});
		await expect(
			page.locator('[data-testid="analysis-result"][data-analysis-id="op1"]')
		).toHaveAttribute('data-status', 'complete');
	});

	test('rejects malformed, unsupported, and hostile model text inline and stores nothing (AE6)', async ({
		page
	}, testInfo) => {
		await createVerifiedAccount(page, uniqueEmail('analog-import-ae6'));
		const created = await apiCreateProject(page, 'import-reject', rcDocument());
		const projectId = String(created['id']);
		await page.goto(`/projects/${projectId}`);

		const dialog = await openImportDialog(page);
		const text = dialog.getByTestId('import-model-text');
		const error = dialog.getByTestId('import-model-error');
		const submit = dialog.getByTestId('import-model-submit');

		const reject = async (source: string, expected: string | RegExp) => {
			await text.fill(source);
			await submit.click();
			await expect(error).toBeVisible();
			await expect(error).toContainText(expected);
			await expect(dialog.getByTestId('import-model-success')).toHaveCount(0);
		};

		await reject('.model bad d(is=1e-14', 'missing closing');
		await reject('.include "vendor.lib"', 'not supported');
		await reject('.inc\n+lude "vendor.lib"', 'not supported');
		await reject('.include\n+ "vendor.lib"', 'not supported');
		await reject('.li\n+b vendor.lib', 'not supported');
		await reject('.subckt evil a b\nX1 a b sub\n.control\nrun\n.endc\n.ends evil', '.control');
		await reject('.subckt a x y\nX1 x y a\n.ends a', 'cycle');
		await reject('x'.repeat(10_001), String(10_000));

		await text.fill('.model <img src=x onerror=alert(1)> d(is=1e-14)');
		await submit.click();
		await expect(error).toBeVisible();
		expect(await error.locator('img').count()).toBe(0);
		await expect(error).not.toContainText('onerror=alert');

		const malformedPath = testInfo.outputPath('malformed-model.cir');
		await writeFile(malformedPath, '.model filebad d(is=1e-14', 'utf8');
		await dialog.getByTestId('import-model-file').setInputFiles(malformedPath);
		await expect(text).toHaveValue(/filebad/);
		await submit.click();
		await expect(error).toContainText('missing closing');
		await dialog.getByTestId('import-model-cancel').click();

		await page.getByTestId('save-project').click();
		await expect(page.getByTestId('save-status')).toHaveText('Saved');
		const saved = await apiGetProject(page, projectId);
		expect(circuitModels(saved['document'])).toEqual([]);
		const serialized = JSON.stringify(saved['document']);
		expect(serialized).not.toContain('.control');
		expect(serialized).not.toContain('.include');
		expect(serialized).not.toContain('<img');
	});

	test('a hostile stored model is caught by per-run re-validation before the engine loads', async ({
		page
	}) => {
		await createVerifiedAccount(page, uniqueEmail('analog-import-hostile'));
		const hostile = {
			name: 'evil',
			formatVersion: 1,
			source: '.model evil d()\n.control\nrun\n.endc'
		};
		const created = await apiCreateProject(page, 'import-hostile', rcDocument([hostile]));
		const projectId = String(created['id']);
		await page.goto(`/projects/${projectId}`);

		let wasmRequests = 0;
		await page.route(WASM_PATTERN, (route) => {
			wasmRequests += 1;
			return route.continue();
		});

		await page.getByTestId('analog-run').click();
		await expect(
			page.locator('.diagnostics .entry', { hasText: 'stored model validation failed' }).first()
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('analog-run-status')).toHaveText('failed');
		await expect(
			page.locator('[data-testid="analysis-result"][data-status="complete"]')
		).toHaveCount(0);
		expect(wasmRequests).toBe(0);
	});
});
