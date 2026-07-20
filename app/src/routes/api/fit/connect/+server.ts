import { redirect, error } from '@sveltejs/kit';
import { buildAuthUrl, fitConfigured } from '$lib/server/fit';
import type { RequestHandler } from './$types';

// Kicks off the OAuth flow. This is a full-page navigation (the browser must land
// on Google's consent screen), so it's linked to directly rather than fetched.
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	if (!fitConfigured()) {
		throw error(503, 'Google Fit is not configured on the server (GOOGLE_CLIENT_ID/SECRET).');
	}
	throw redirect(302, buildAuthUrl(url.origin));
};
