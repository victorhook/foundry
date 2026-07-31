import { json, error } from '@sveltejs/kit';
import { savePushSubscription, deletePushSubscription } from '$lib/server/db';
import { pushConfigured, vapidPublicKey } from '$lib/server/push';
import type { RequestHandler } from './$types';

// The client needs the VAPID public key (and whether push is set up at all)
// before it can subscribe. Not secret — safe to return.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	return json({ configured: pushConfigured(), publicKey: vapidPublicKey() });
};

// Store a browser PushSubscription. Body: the subscription JSON
// { endpoint, keys: { p256dh, auth } }.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const endpoint = String(b?.endpoint ?? '');
	const p256dh = String(b?.keys?.p256dh ?? '');
	const auth = String(b?.keys?.auth ?? '');
	if (!endpoint || !p256dh || !auth) {
		throw error(400, 'Invalid subscription');
	}
	savePushSubscription({ endpoint, p256dh, auth });
	return json({ ok: true });
};

// Remove a subscription (unsubscribe). Body: { endpoint }.
export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deletePushSubscription(String(b?.endpoint ?? ''));
	return json({ ok: true });
};
