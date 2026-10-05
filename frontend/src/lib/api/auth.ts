import { apiFetch, clearCsrf } from './client';

export interface Me {
	id: string;
	email: string;
	verified: boolean;
}

export interface StatusResponse {
	status: string;
}

export async function fetchMe(): Promise<Me> {
	return apiFetch<Me>('/api/auth/me');
}

export async function register(email: string, password: string): Promise<StatusResponse> {
	return apiFetch<StatusResponse>('/api/auth/register', {
		method: 'POST',
		body: { email, password }
	});
}

export async function verifyEmail(token: string): Promise<void> {
	await apiFetch<void>('/api/auth/verify-email', { method: 'POST', body: { token } });
}

export async function resendVerification(email: string): Promise<StatusResponse> {
	return apiFetch<StatusResponse>('/api/auth/verify-email/resend', {
		method: 'POST',
		body: { email }
	});
}

export async function login(email: string, password: string, rememberMe = false): Promise<void> {
	await apiFetch<void>('/api/auth/login', {
		method: 'POST',
		body: { email, password, rememberMe }
	});
	clearCsrf();
}

export async function logout(): Promise<void> {
	await apiFetch<void>('/api/auth/logout', { method: 'POST' });
	clearCsrf();
}

export async function requestPasswordReset(email: string): Promise<StatusResponse> {
	return apiFetch<StatusResponse>('/api/auth/password/reset-request', {
		method: 'POST',
		body: { email }
	});
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
	await apiFetch<void>('/api/auth/password/reset', {
		method: 'POST',
		body: { token, newPassword }
	});
	clearCsrf();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
	await apiFetch<void>('/api/auth/password/change', {
		method: 'POST',
		body: { currentPassword, newPassword }
	});
}

export async function logoutAll(): Promise<void> {
	await apiFetch<void>('/api/auth/logout-all', { method: 'POST' });
	clearCsrf();
}
