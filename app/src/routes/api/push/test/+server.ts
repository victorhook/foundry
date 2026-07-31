import { json, error } from '@sveltejs/kit';
import { sendPushToAll, pushConfigured } from '$lib/server/push';
import type { RequestHandler } from './$types';

// Fire a test notification to all this account's subscriptions, so you can
// confirm end-to-end delivery on your phone after setting up.
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	if (!pushConfigured()) {
		throw error(400, 'Push is not configured on the server');
	}
	const sent = await sendPushToAll({
		title: 'Foundry',
		body: 'Test notification — reminders are working ✓',
		url: '/',
		tag: 'foundry-test'
	});
	return json({ ok: true, sent });
};
