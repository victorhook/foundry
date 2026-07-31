// Web Push (VAPID) — server side.
//
// Foundry is single-user but may be installed on several devices, so we keep a
// row per push subscription. Reminders (see scheduler.ts) send a notification to
// every stored subscription; dead ones (410/404) are pruned on send.
//
// Config: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (a mailto: or URL).
// Generate a keypair once with `npx web-push generate-vapid-keys`. With the vars
// unset the whole feature is inert (the client hides the reminders UI).

import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { getPushSubscriptions, deletePushSubscription, type PushSubscriptionRow } from './db';

export function pushConfigured(): boolean {
	return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
	return env.VAPID_PUBLIC_KEY || '';
}

let configured = false;
function ensureVapid() {
	if (configured) {
		return;
	}
	if (!pushConfigured()) {
		throw new Error('VAPID keys are not set');
	}
	webpush.setVapidDetails(
		env.VAPID_SUBJECT || 'mailto:foundry@localhost',
		env.VAPID_PUBLIC_KEY as string,
		env.VAPID_PRIVATE_KEY as string
	);
	configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

// Send one payload to every stored subscription. Prunes subscriptions the push
// service reports as gone (410 Gone / 404). Returns how many were delivered.
export async function sendPushToAll(payload: PushPayload): Promise<number> {
	if (!pushConfigured()) {
		return 0;
	}
	ensureVapid();
	const subs = getPushSubscriptions();
	const body = JSON.stringify(payload);
	let sent = 0;
	await Promise.all(
		subs.map(async (s: PushSubscriptionRow) => {
			try {
				await webpush.sendNotification(
					{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
					body
				);
				sent++;
			} catch (err: any) {
				const code = err && err.statusCode;
				if (code === 404 || code === 410) {
					deletePushSubscription(s.endpoint); // gone for good — prune
				}
			}
		})
	);
	return sent;
}
