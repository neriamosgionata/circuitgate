import { error, redirect } from '@sveltejs/kit';

import { backendOrigin, forwardedCookieHeaders } from '#lib/server/backend';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch, request, url }) => {
	let response: Response;
	try {
		response = await fetch(`${backendOrigin()}/api/auth/me`, {
			headers: forwardedCookieHeaders(request)
		});
	} catch {
		error(503, 'The account service is unavailable. Try again shortly.');
	}
	if (response.status === 401 || response.status === 403) {
		const redirectTo = `${url.pathname}${url.search}`;
		redirect(302, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}
	if (!response.ok) {
		error(502, 'The account service returned an unexpected response.');
	}
	const user = (await response.json()) as App.Me;
	return { user };
};
