import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { apiGetProject } from './helpers';
import { expectByte, openFixture, pulseClock, readByte, setSwitch } from './logic';

// AE4: export a CPU project (subcircuits plus memory) and import it again.
// The imported project must hold the identical document and must reproduce the
// identical simulation results when its program is clocked a second time.
test.describe('AE4: export round-trip', () => {
	test('an exported project imports with identical structure and simulation results', async ({
		page
	}) => {
		const { projectId } = await openFixture(page, 'cpu-project.json', {
			emailPrefix: 'export-import',
			projectName: 'export-source'
		});
		const runProgram = async (): Promise<{ a: number; mem0: number; mem1: number }> => {
			await setSwitch(page, 'SEL', 0);
			for (let edge = 0; edge < 4; edge += 1) await pulseClock(page);
			await expectByte(page, 'A', 2, 4);
			await setSwitch(page, 'SEL', 0);
			await expectByte(page, 'RD', 1, 4);
			const mem0 = await readByte(page, 'RD', 4);
			await setSwitch(page, 'SEL', 1);
			await expectByte(page, 'RD', 2, 4);
			const mem1 = await readByte(page, 'RD', 4);
			return { a: 2, mem0, mem1 };
		};

		const before = await runProgram();

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

		const original = await apiGetProject(page, projectId);
		expect(envelope.document).toEqual(original['document']);

		await page.goto('/projects');
		await page.getByTestId('import-file').setInputFiles(downloadedPath!);
		await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
		const importedId = page.url().split('/').pop()!;
		await expect(page.getByTestId('component-count')).not.toHaveText('0 components');

		const imported = await apiGetProject(page, importedId);
		expect(imported['document']).toEqual(original['document']);

		const after = await runProgram();
		expect(after).toEqual(before);
	});
});
