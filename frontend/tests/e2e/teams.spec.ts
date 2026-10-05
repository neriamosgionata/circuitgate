import { expect, test } from '@playwright/test';

import { createVerifiedAccount, csrfHeaders, uniqueEmail } from './helpers';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';

test.describe('teams', () => {
	test('membership controls visibility, adds, removals, and the protected owner', async ({ browser }) => {
		const aliceEmail = uniqueEmail('teams-alice');
		const bobEmail = uniqueEmail('teams-bob');
		const aliceContext = await browser.newContext({ baseURL: BASE_URL });
		const bobContext = await browser.newContext({ baseURL: BASE_URL });
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await createVerifiedAccount(bob, bobEmail);
			await createVerifiedAccount(alice, aliceEmail);

			await alice.goto('/teams');
			await alice.getByPlaceholder('New team name').fill('Alpha');
			await alice.getByTestId('create-team').click();
			const aliceTeamRow = alice.getByTestId('team-row').filter({ hasText: 'Alpha' });
			await expect(aliceTeamRow).toBeVisible();
			await expect(aliceTeamRow.getByText('owner')).toBeVisible();

			await bob.goto('/teams');
			await expect(bob.getByTestId('team-row')).toHaveCount(0);

			await aliceTeamRow.getByTestId('team-name').click();
			await expect(alice.getByTestId('team-detail')).toBeVisible();
			await expect(alice.getByTestId('team-role')).toHaveText('owner');

			await alice.getByPlaceholder('Member email').fill(bobEmail);
			await alice.getByTestId('add-member').click();
			const bobRow = alice.getByTestId('member-row').filter({ hasText: bobEmail });
			await expect(bobRow).toBeVisible();
			await expect(bobRow.getByText('member')).toBeVisible();

			await bob.reload();
			const bobTeamRow = bob.getByTestId('team-row').filter({ hasText: 'Alpha' });
			await expect(bobTeamRow).toBeVisible();
			await bobTeamRow.getByTestId('team-name').click();
			await expect(bob.getByTestId('team-role')).toHaveText('member');
			await expect(bob.getByTestId('member-row').filter({ hasText: aliceEmail })).toBeVisible();

			await alice.getByPlaceholder('Member email').fill(uniqueEmail('teams-ghost'));
			await alice.getByTestId('add-member').click();
			await expect(alice.getByTestId('team-error')).toContainText('cannot be added');

			const teamsResponse = await alice.context().request.get('/api/teams');
			expect(teamsResponse.ok()).toBe(true);
			const teams = (await teamsResponse.json()) as { id: string; name: string }[];
			const teamId = teams.find((team) => team.name === 'Alpha')?.id;
			expect(teamId).toBeDefined();

			const ownerRow = alice.getByTestId('member-row').filter({ hasText: aliceEmail });
			await expect(ownerRow.getByTestId('remove-member')).toHaveCount(0);
			const detailResponse = await alice.context().request.get(`/api/teams/${teamId}`);
			const detail = (await detailResponse.json()) as {
				members: { userId: string; role: string }[];
			};
			const ownerId = detail.members.find((member) => member.role === 'owner')?.userId;
			expect(ownerId).toBeDefined();
			const headers = await csrfHeaders(alice);
			const protectedRemoval = await alice
				.context()
				.request.delete(`/api/teams/${teamId}/members/${ownerId}`, { headers });
			expect(protectedRemoval.status()).toBe(409);

			await bobRow.getByTestId('remove-member').click();
			await expect(alice.getByTestId('member-row').filter({ hasText: bobEmail })).toHaveCount(0);

			await bob.reload();
			await expect(bob.getByTestId('team-row')).toHaveCount(0);
			const denied = await bob.context().request.get(`/api/teams/${teamId}`);
			expect(denied.status()).toBe(404);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});
