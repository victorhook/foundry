import { json, error } from '@sveltejs/kit';
import { fetchStepDays, fitConfigured } from '$lib/server/fit';
import { isFitConnected, upsertStepDays, getStepDays, clearFitAccount } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Pull recent daily step counts from Google Fit and persist them. Body: { days? }.
// Returns the full stored step history so the client can refresh its state.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	if (!fitConfigured()) {
		throw error(503, 'Google Fit is not configured on the server.');
	}
	if (!isFitConnected()) {
		throw error(409, 'Google Fit is not connected.');
	}

	let days = 30;
	try {
		const b = await request.json();
		if (b && Number.isFinite(Number(b.days))) {
			days = Math.min(90, Math.max(1, Math.floor(Number(b.days))));
		}
	} catch {
		// no body -> default range
	}

	try {
		const rows = await fetchStepDays(days);
		upsertStepDays(rows);
	} catch (e) {
		console.error('[fit] sync failed:', e);
		throw error(502, 'Could not sync from Google Fit.');
	}
	return json({ steps: getStepDays() });
};

// Disconnect: forget the tokens. Historical step_day rows are kept (they're just
// data); a fresh connect will start updating them again.
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	clearFitAccount();
	return json({ ok: true });
};
