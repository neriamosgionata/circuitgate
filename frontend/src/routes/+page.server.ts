import { redirect } from '@sveltejs/kit';

import type { PageServerLoad } from './$types';

// The app has no landing page: send visitors to their projects, which the
// (app) layout redirects to /login when signed out.
export const load: PageServerLoad = () => {
	redirect(302, '/projects');
};
