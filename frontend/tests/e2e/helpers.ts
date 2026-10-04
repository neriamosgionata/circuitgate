import { expect, type APIResponse, type Page } from '@playwright/test';

export const TEST_PASSWORD = 'correct-horse-battery';
export const NEW_PASSWORD = 'staple-battery-correct';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitAddress {
	Name?: string;
	Address?: string;
}

interface MailpitMessage {
	ID: string;
	To?: MailpitAddress[];
	Subject?: string;
}

interface MailpitMessageDetail {
	Text?: string;
	HTML?: string;
}

export function uniqueEmail(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.test`;
}

export async function registerAccount(page: Page, email: string, password = TEST_PASSWORD): Promise<void> {
	await page.goto('/register');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Confirm password').fill(password);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByText('Check your inbox for a verification link')).toBeVisible();
}

export async function signIn(page: Page, email: string, password = TEST_PASSWORD): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/projects$/);
}

export async function signOut(page: Page): Promise<void> {
	await page.getByTestId('logout').click();
	await expect(page).toHaveURL(/\/login$/);
}

export async function latestEmailToken(email: string, subjectPart: string): Promise<string> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const listing = await fetch(`${MAILPIT_URL}/api/v1/messages`);
		if (!listing.ok) {
			throw new Error(`Mailpit is not reachable at ${MAILPIT_URL} (status ${listing.status})`);
		}
		const body = (await listing.json()) as { messages?: MailpitMessage[] };
		const match = (body.messages ?? []).find(
			(message) =>
				(message.To ?? []).some(
					(address) => address.Address?.toLowerCase() === email.toLowerCase()
				) && (message.Subject ?? '').includes(subjectPart)
		);
		if (match) {
			const detailResponse = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
			const detail = (await detailResponse.json()) as MailpitMessageDetail;
			const text = detail.Text ?? detail.HTML ?? '';
			const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
			if (token) return token;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`No "${subjectPart}" email for ${email} arrived at ${MAILPIT_URL}`);
}

export async function createVerifiedAccount(
	page: Page,
	email: string,
	password = TEST_PASSWORD
): Promise<void> {
	await registerAccount(page, email, password);
	const token = await latestEmailToken(email, 'Verify your CircuitGate account');
	await page.goto(`/verify?token=${encodeURIComponent(token)}`);
	await expect(page.getByText('Your email address is verified.')).toBeVisible();
	await signIn(page, email, password);
}

export async function csrfHeaders(page: Page): Promise<Record<string, string>> {
	const response = await page.context().request.get('/api/auth/csrf');
	expect(response.ok()).toBe(true);
	const body = (await response.json()) as { token: string; headerName: string };
	return { [body.headerName]: body.token };
}

export async function apiCreateProject(
	page: Page,
	name: string,
	document: unknown
): Promise<Record<string, unknown>> {
	const headers = await csrfHeaders(page);
	const response = await page.context().request.post('/api/projects', {
		headers,
		data: { name, schemaVersion: 1, document }
	});
	expect(response.status()).toBe(201);
	return (await response.json()) as Record<string, unknown>;
}

export async function apiSaveProject(
	page: Page,
	id: string,
	name: string,
	version: number,
	document: unknown
): Promise<APIResponse> {
	const headers = await csrfHeaders(page);
	return page.context().request.put(`/api/projects/${id}`, {
		headers,
		data: { name, schemaVersion: 1, version, document }
	});
}

export async function apiGetProject(page: Page, id: string): Promise<Record<string, unknown>> {
	const response = await page.context().request.get(`/api/projects/${id}`);
	expect(response.ok()).toBe(true);
	return (await response.json()) as Record<string, unknown>;
}

export async function placeComponent(page: Page, kind: string): Promise<void> {
	await page.getByRole('button', { name: kind, exact: true }).click();
	const canvas = page.locator('.canvas-slot canvas');
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.click(box!.x + 260, box!.y + 180);
}

export function seededDocument(): Record<string, unknown> {
	return {
		circuit: {
			schemaVersion: 1,
			components: [
				{ id: 'c1', kind: 'switch', inputs: {}, outputs: { out: 'n1' } },
				{ id: 'c2', kind: 'led', inputs: { in: 'n1' }, outputs: {} }
			]
		},
		definitions: {},
		layouts: {
			'': {
				c1: { position: { x: 40, y: 80 } },
				c2: { position: { x: 280, y: 80 }, label: '<b>lamp</b>' }
			}
		}
	};
}
