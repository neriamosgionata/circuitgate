import { error, redirect } from '@sveltejs/kit';

import type { ProjectDetail } from '#lib/api/projects';
import { backendOrigin, forwardedCookieHeaders } from '#lib/server/backend';

import type { PageServerLoad } from './$types';

// The authenticated editor is client-rendered; the server load still runs and
// forwards the session cookie so the project arrives with the first data fetch.
export const ssr = false;

export const load: PageServerLoad = async ({ fetch, params, request, url }) => {
	let response: Response;
	try {
		response = await fetch(`${backendOrigin()}/api/projects/${encodeURIComponent(params.id)}`, {
			headers: forwardedCookieHeaders(request)
		});
	} catch {
		error(503, 'The project service is unavailable. Try again shortly.');
	}
	if (response.status === 401 || response.status === 403) {
		redirect(302, `/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	}
	if (response.status === 404) {
		error(404, 'Project not found.');
	}
	if (!response.ok) {
		error(502, 'The project service returned an unexpected response.');
	}
	const project = (await response.json()) as ProjectDetail;
	return { project };
};
