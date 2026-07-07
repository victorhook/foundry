import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	// Everything except the login page requires a session.
	if (!locals.userId && url.pathname !== '/login') {
		throw redirect(303, '/login');
	}
	return { loggedIn: !!locals.userId };
};
