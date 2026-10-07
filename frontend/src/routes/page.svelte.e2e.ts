import { expect, test } from '@playwright/test';

test('root redirects into the app', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login/);
	await expect(page.locator('h1')).toBeVisible();
});
