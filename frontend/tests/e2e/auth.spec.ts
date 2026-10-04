import { expect, test } from '@playwright/test';

import {
	createVerifiedAccount,
	latestEmailToken,
	NEW_PASSWORD,
	registerAccount,
	signIn,
	signOut,
	TEST_PASSWORD,
	uniqueEmail
} from './helpers';

test.describe('auth flows', () => {
	test('register, capture the verification link, verify, and sign in', async ({ page }) => {
		const email = uniqueEmail('auth-register');
		await registerAccount(page, email);

		const token = await latestEmailToken(email, 'Verify your CircuitGate account');
		await page.goto(`/verify?token=${encodeURIComponent(token)}`);
		await expect(page.getByText('Your email address is verified.')).toBeVisible();

		await signIn(page, email);
		await expect(page.locator('.email')).toHaveText(email);
	});

	test('sign out from the app shell ends the session', async ({ page }) => {
		const email = uniqueEmail('auth-logout');
		await createVerifiedAccount(page, email);

		await signOut(page);
		await page.goto('/projects');
		await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprojects$/);
	});

	test('unauthenticated access to app routes redirects to login and returns after sign-in', async ({
		page
	}) => {
		await page.goto('/projects');
		await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprojects$/);
		await page.goto('/account');
		await expect(page).toHaveURL(/\/login\?redirectTo=%2Faccount$/);

		const email = uniqueEmail('auth-redirect');
		await registerAccount(page, email);
		const token = await latestEmailToken(email, 'Verify your CircuitGate account');
		await page.goto(`/verify?token=${encodeURIComponent(token)}`);
		await expect(page.getByText('Your email address is verified.')).toBeVisible();

		await page.goto('/login?redirectTo=%2Faccount');
		await page.getByLabel('Email').fill(email);
		await page.getByLabel('Password').fill(TEST_PASSWORD);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/account$/);
	});

	test('password reset request, link consumption, and sign-in with the new password', async ({ page }) => {
		const email = uniqueEmail('auth-reset');
		await createVerifiedAccount(page, email);
		await signOut(page);

		await page.goto('/reset');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: 'Send reset link' }).click();
		await expect(page.getByText('If an account exists for that address')).toBeVisible();

		const token = await latestEmailToken(email, 'Reset your CircuitGate password');
		await page.goto(`/reset?token=${encodeURIComponent(token)}`);
		await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
		await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
		await page.getByRole('button', { name: 'Set new password' }).click();
		await expect(page.getByText('Your password has been updated.')).toBeVisible();

		await signIn(page, email, NEW_PASSWORD);
	});

	test('expired verification and reset links show their states and resend works', async ({ page }) => {
		const email = uniqueEmail('auth-expired');
		await registerAccount(page, email);

		await page.goto('/verify?token=definitely-not-a-real-token');
		await expect(page.getByText('That verification link is invalid or has expired.')).toBeVisible();
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: 'Resend verification email' }).click();
		await expect(page.getByText('A fresh verification link is on its way.')).toBeVisible();

		const token = await latestEmailToken(email, 'Verify your CircuitGate account');
		await page.goto(`/verify?token=${encodeURIComponent(token)}`);
		await expect(page.getByText('Your email address is verified.')).toBeVisible();

		await page.goto('/reset?token=definitely-not-a-real-token');
		await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
		await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
		await page.getByRole('button', { name: 'Set new password' }).click();
		await expect(page.getByText('That reset link is invalid or has expired.')).toBeVisible();
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: 'Send reset link' }).click();
		await expect(page.getByText('If an account exists for that address')).toBeVisible();
	});

	test('account page changes the password, ends other sessions, and logs out everywhere', async ({
		browser
	}) => {
		const email = uniqueEmail('auth-account');
		const contextA = await browser.newContext();
		const pageA = await contextA.newPage();
		await createVerifiedAccount(pageA, email);

		const contextB = await browser.newContext();
		const pageB = await contextB.newPage();
		await signIn(pageB, email);

		await pageA.goto('/account');
		await pageA.getByLabel('Current password').fill(TEST_PASSWORD);
		await pageA.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
		await pageA.getByLabel('Confirm new password').fill(NEW_PASSWORD);
		await pageA.getByTestId('change-password').click();
		await expect(pageA.getByText('Password changed. Other sessions have been signed out.')).toBeVisible();

		await pageB.goto('/projects');
		await expect(pageB).toHaveURL(/\/login\?redirectTo=%2Fprojects$/);

		await pageA.getByTestId('logout-all').click();
		await pageA.getByTestId('logout-all-confirm').click();
		await expect(pageA).toHaveURL(/\/login$/);

		await pageA.goto('/projects');
		await expect(pageA).toHaveURL(/\/login/);

		await signIn(pageB, email, NEW_PASSWORD);

		await contextA.close();
		await contextB.close();
	});
});
