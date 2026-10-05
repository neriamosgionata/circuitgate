import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page } from '@playwright/test';

import { apiCreateProject, createVerifiedAccount, uniqueEmail } from './helpers';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export type FixtureDocument = Record<string, unknown>;

export async function loadFixture(name: string): Promise<FixtureDocument> {
	return JSON.parse(await readFile(path.join(FIXTURE_DIR, name), 'utf8')) as FixtureDocument;
}

export async function openFixture(
	page: Page,
	fixtureName: string,
	options: { emailPrefix?: string; projectName?: string } = {}
): Promise<{ projectId: string; document: FixtureDocument }> {
	const document = await loadFixture(fixtureName);
	const email = uniqueEmail(options.emailPrefix ?? 'logic');
	await createVerifiedAccount(page, email);
	const project = await apiCreateProject(
		page,
		options.projectName ?? fixtureName.replace(/\.json$/, ''),
		document
	);
	const projectId = String(project['id']);
	await page.goto(`/projects/${projectId}`);
	return { projectId, document };
}

export function switchButton(page: Page, label: string) {
	return page.locator('.io button.switch', {
		has: page.locator(`.switch-name:text-is("${label}")`)
	});
}

export function probe(page: Page, label: string) {
	return page.locator('.probe', {
		has: page.locator(`.label:text-is("${label}")`)
	});
}

export async function setSwitch(page: Page, label: string, value: 0 | 1): Promise<void> {
	const button = switchButton(page, label);
	await expect(button).toBeVisible();
	// The switch shows "–" until the worker's first value event arrives;
	// clicking before then would toggle from an unobserved state.
	await expect(button.locator('.switch-value')).not.toHaveText('–');
	const current = (await button.locator('.switch-value').textContent())?.trim();
	if (current !== String(value)) {
		await button.click();
	}
	await expect(button.locator('.switch-value')).toHaveText(String(value));
}

export async function pulseClock(page: Page, label = 'CLK'): Promise<void> {
	await setSwitch(page, label, 1);
	await setSwitch(page, label, 0);
}

export async function expectProbe(page: Page, label: string, value: string): Promise<void> {
	await expect(probe(page, label).locator('.value')).toHaveText(value, { timeout: 10_000 });
}

export async function readProbe(page: Page, label: string): Promise<string> {
	return (await probe(page, label).locator('.value').textContent())?.trim() ?? '';
}

export async function readByte(page: Page, prefix: string, width = 8): Promise<number> {
	return page.evaluate(
		({ bitPrefix, bits }) => {
			let value = 0;
			for (let index = 0; index < bits; index += 1) {
				const probes = [...document.querySelectorAll('.probe')];
				const match = probes.find(
					(element) => element.querySelector('.label')?.textContent?.trim() === `${bitPrefix}${index}`
				);
				const bit = match?.querySelector('.value')?.textContent?.trim();
				if (bit === '1') value |= 1 << index;
				else if (bit !== '0') {
					throw new Error(`probe ${bitPrefix}${index} is ${bit ?? 'missing'}, expected 0 or 1`);
				}
			}
			return value;
		},
		{ bitPrefix: prefix, bits: width }
	);
}

export async function expectByte(
	page: Page,
	prefix: string,
	expected: number,
	width = 8
): Promise<void> {
	await expect
		.poll(() => readByte(page, prefix, width), { timeout: 10_000, intervals: [10, 25, 50] })
		.toBe(expected);
}

export async function setByte(page: Page, prefix: string, value: number): Promise<void> {
	for (let bit = 0; bit < 8; bit += 1) {
		await setSwitch(page, `${prefix}${bit}`, ((value >> bit) & 1) as 0 | 1);
	}
}
