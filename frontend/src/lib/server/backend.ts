import { CIRCUITGATE_API_ORIGIN } from '$app/env/private';

export function backendOrigin(): string {
	return CIRCUITGATE_API_ORIGIN;
}

export function forwardedCookieHeaders(request: Request): Record<string, string> {
	const cookie = request.headers.get('cookie');
	return cookie ? { cookie } : {};
}
