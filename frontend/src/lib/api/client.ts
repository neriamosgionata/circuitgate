const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

export interface ApiErrorBody {
	error?: string;
	version?: number;
	[key: string]: unknown;
}

export class ApiError extends Error {
	readonly status: number;
	readonly body: ApiErrorBody;

	constructor(status: number, body: ApiErrorBody) {
		super(body.error ?? `HTTP ${status}`);
		this.name = 'ApiError';
		this.status = status;
		this.body = body;
	}
}

interface CsrfToken {
	token: string;
	headerName: string;
}

let csrf: CsrfToken | null = null;
let csrfPending: Promise<CsrfToken> | null = null;

export function clearCsrf(): void {
	csrf = null;
	csrfPending = null;
}

async function loadCsrf(): Promise<CsrfToken> {
	if (csrf) return csrf;
	if (!csrfPending) {
		csrfPending = fetch('/api/auth/csrf', { credentials: 'same-origin' })
			.then(async (response) => {
				if (!response.ok) throw new ApiError(response.status, { error: 'csrf_unavailable' });
				const body = (await response.json()) as CsrfToken;
				csrf = body;
				return body;
			})
			.finally(() => {
				csrfPending = null;
			});
	}
	return csrfPending;
}

async function readBody(response: Response): Promise<ApiErrorBody> {
	const text = await response.text();
	if (text.length === 0) return {};
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed !== null && typeof parsed === 'object' ? (parsed as ApiErrorBody) : {};
	} catch {
		return {};
	}
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
	body?: unknown;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
	const method = (options.method ?? 'GET').toUpperCase();
	const mutating = !SAFE_METHODS.has(method);
	let attempt = 0;

	for (;;) {
		attempt += 1;
		const headers = new Headers(options.headers);
		if (options.body !== undefined && !headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
		if (mutating) {
			const token = await loadCsrf();
			headers.set(token.headerName, token.token);
		}
		const response = await fetch(path, {
			...options,
			method,
			headers,
			credentials: 'same-origin',
			body: options.body === undefined ? undefined : JSON.stringify(options.body)
		});
		if (response.status === 403 && mutating && attempt === 1) {
			clearCsrf();
			continue;
		}
		if (!response.ok) {
			throw new ApiError(response.status, await readBody(response));
		}
		if (response.status === 204 || response.status === 205) {
			return undefined as T;
		}
		const text = await response.text();
		if (text.length === 0) return undefined as T;
		return JSON.parse(text) as T;
	}
}

export function isUnauthenticated(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export function apiErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		switch (error.status) {
			case 401:
				return 'Your session has ended. Sign in to continue.';
			case 403:
				return 'You do not have access to that action.';
			case 409:
				return 'This project changed on the server.';
			case 413:
				return 'The project document is too large to save.';
			case 429:
				return 'Too many requests. Wait a moment and try again.';
			case 503:
				return 'The mail service is unavailable. Try again later.';
			default:
				return 'The request failed. Try again.';
		}
	}
	return error instanceof Error ? error.message : 'Something went wrong.';
}

export function authErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		switch (error.body.error) {
			case 'invalid_credentials':
				return 'Email or password is incorrect.';
			case 'email_not_verified':
				return 'Verify your email address before signing in.';
			case 'invalid_password':
				return 'The current password is incorrect.';
			case 'invalid_token':
				return 'That link is invalid or has expired.';
			case 'rate_limited':
				return 'Too many attempts. Wait a few minutes and try again.';
			case 'invalid_request':
				return 'Check the details you entered and try again.';
			case 'mail_unavailable':
				return 'The mail service is unavailable. Try again later.';
			default:
				break;
		}
	}
	return apiErrorMessage(error);
}

export function safeRedirectTarget(raw: string | null, fallback = '/projects'): string {
	if (!raw) return fallback;
	if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
	return raw;
}
