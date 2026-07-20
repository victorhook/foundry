import { redirect, error } from '@sveltejs/kit';
import { exchangeCode, fitConfigured } from '$lib/server/fit';
import type { RequestHandler } from './$types';

// Google redirects here after consent. We exchange the code for tokens, then
// bounce back into the app with a status flag the client turns into a toast +
// first sync. Errors also come back on the query string.
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	if (!fitConfigured()) {
		throw error(503, 'Google Fit is not configured on the server.');
	}

	const denied = url.searchParams.get('error');
	if (denied) {
		throw redirect(303, '/?fit=denied');
	}
	const code = url.searchParams.get('code');
	if (!code) {
		throw redirect(303, '/?fit=error');
	}

	try {
		await exchangeCode(code, url.origin);
	} catch (e) {
		console.error('[fit] token exchange failed:', e);
		throw redirect(303, '/?fit=error');
	}
	throw redirect(303, '/?fit=connected');
};
