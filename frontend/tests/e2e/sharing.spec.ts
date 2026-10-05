import { expect, test } from '@playwright/test';

import { createVerifiedAccount, placeComponent, uniqueEmail } from './helpers';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const UUID_PATTERN = /\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function waitForLive(page: import('@playwright/test').Page): Promise<void> {
	await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-status', 'connected', {
		timeout: 15_000
	});
}

test.describe('project sharing and locks', () => {
	test('AE3: a shared project locks to one editor and hands over on release', async ({ browser }) => {
		const ownerEmail = uniqueEmail('sharing-owner');
		const memberEmail = uniqueEmail('sharing-member');
		const teamName = `AE3-${Date.now()}`;
		const ownerContext = await browser.newContext({ baseURL: BASE_URL });
		const memberContext = await browser.newContext({ baseURL: BASE_URL });
		const owner = await ownerContext.newPage();
		const member = await memberContext.newPage();

		try {
			await createVerifiedAccount(member, memberEmail);
			await createVerifiedAccount(owner, ownerEmail);

			await owner.goto('/projects');
			await owner.getByPlaceholder('New project name').fill('shared-lock');
			await owner.getByTestId('create-project').click();
			await expect(owner).toHaveURL(UUID_PATTERN);
			const projectUrl = owner.url();
			await waitForLive(owner);
			await expect(owner.getByTestId('lock-banner')).toHaveAttribute('data-role', 'holder');

			await owner.goto('/teams');
			await owner.getByPlaceholder('New team name').fill(teamName);
			await owner.getByTestId('create-team').click();
			const teamRow = owner.getByTestId('team-row').filter({ hasText: teamName });
			await expect(teamRow).toBeVisible();
			await teamRow.getByTestId('team-name').click();
			await owner.getByPlaceholder('Member email').fill(memberEmail);
			await owner.getByTestId('add-member').click();
			await expect(owner.getByTestId('member-row').filter({ hasText: memberEmail })).toBeVisible();

			await owner.goto(projectUrl);
			await waitForLive(owner);
			await expect(owner.getByTestId('lock-banner')).toHaveAttribute('data-role', 'holder');
			await owner.getByTestId('share-project').click();
			const dialog = owner.getByTestId('share-dialog');
			await expect(dialog).toBeVisible();
			await owner.getByTestId('share-team-select').selectOption({ label: teamName });
			await owner.getByTestId('share-add').click();
			await expect(dialog.getByTestId('share-row').filter({ hasText: teamName })).toBeVisible();
			await owner.getByTestId('share-close').click();

			await owner.goto('/projects');
			await expect(owner.getByTestId('project-row').filter({ hasText: 'shared-lock' })).toBeVisible();

			await member.goto('/projects');
			const sharedRow = member.getByTestId('project-row').filter({ hasText: 'shared-lock' });
			await expect(sharedRow).toBeVisible();
			await expect(sharedRow.getByTestId('shared-tag')).toBeVisible();
			await sharedRow.getByTestId('project-name').click();
			await expect(member).toHaveURL(UUID_PATTERN);
			await waitForLive(member);
			await expect(member.getByTestId('lock-holder')).toBeVisible({ timeout: 15_000 });

			await owner.goto(projectUrl);
			await waitForLive(owner);
			await expect(owner.getByTestId('lock-busy')).toContainText(memberEmail, { timeout: 15_000 });
			await expect(owner.getByTestId('save-project')).toBeDisabled();

			await placeComponent(member, 'and');
			await expect(member.getByTestId('component-count')).toHaveText('1 components');
			await member.getByTestId('save-project').click();
			await expect(member.getByTestId('save-status')).toHaveText('Saved');
			await expect(member.getByTestId('lock-holder')).toBeVisible();

			await member.getByTestId('lock-release').click();

			await expect(owner.getByTestId('lock-holder')).toBeVisible({ timeout: 15_000 });
			await expect(owner.getByTestId('component-count')).toHaveText('1 components');
			await expect(owner.getByTestId('save-project')).toBeEnabled();
			await expect(member.getByTestId('lock-busy')).toContainText(ownerEmail, { timeout: 15_000 });
		} finally {
			await ownerContext.close();
			await memberContext.close();
		}
	});

	test('non-members cannot see or open a project shared with a team', async ({ browser }) => {
		const ownerEmail = uniqueEmail('sharing-hidden-owner');
		const outsiderEmail = uniqueEmail('sharing-outsider');
		const teamName = `Hidden-${Date.now()}`;
		const ownerContext = await browser.newContext({ baseURL: BASE_URL });
		const outsiderContext = await browser.newContext({ baseURL: BASE_URL });
		const owner = await ownerContext.newPage();
		const outsider = await outsiderContext.newPage();

		try {
			await createVerifiedAccount(owner, ownerEmail);
			await createVerifiedAccount(outsider, outsiderEmail);

			await owner.goto('/projects');
			await owner.getByPlaceholder('New project name').fill('hidden-share');
			await owner.getByTestId('create-project').click();
			await expect(owner).toHaveURL(UUID_PATTERN);
			const projectUrl = owner.url();

			await owner.goto('/teams');
			await owner.getByPlaceholder('New team name').fill(teamName);
			await owner.getByTestId('create-team').click();
			const teamRow = owner.getByTestId('team-row').filter({ hasText: teamName });
			await teamRow.getByTestId('team-name').click();

			await owner.goto(projectUrl);
			await waitForLive(owner);
			await owner.getByTestId('share-project').click();
			await owner.getByTestId('share-team-select').selectOption({ label: teamName });
			await owner.getByTestId('share-add').click();
			await expect(owner.getByTestId('share-row').filter({ hasText: teamName })).toBeVisible();
			await owner.getByTestId('share-close').click();

			await outsider.goto('/projects');
			await expect(outsider.getByTestId('project-row')).toHaveCount(0);

			await outsider.goto(projectUrl);
			await expect(outsider.getByText('Project not found.')).toBeVisible();
		} finally {
			await ownerContext.close();
			await outsiderContext.close();
		}
	});
});