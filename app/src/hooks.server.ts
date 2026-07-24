import crypto from 'node:crypto';
import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { SESSION_COOKIE, verifySession, createSession, sessionCookieOptions } from '$lib/server/auth';
import { getFirstUserId } from '$lib/server/db';

/** Constant-time string compare (avoids leaking the token via timing). */
function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	let userId = verifySession(token);
	const viaCookie = userId !== null;

	// Automation/read API: a bearer token grants READ-ONLY access (GET only) as
	// the single app user. Enabled by setting API_TOKEN; no session cookie is
	// issued for these requests. See docs/api.md.
	if (userId === null && event.request.method === 'GET') {
		const apiToken = env.API_TOKEN;
		const auth = event.request.headers.get('authorization');
		if (apiToken && auth && safeEqual(auth, `Bearer ${apiToken}`)) {
			userId = getFirstUserId();
		}
	}

	event.locals.userId = userId;

	// Rolling session: every authenticated *browser* request resets the 30-day
	// window. Bearer (API) requests never get a cookie.
	if (viaCookie && userId !== null) {
		event.cookies.set(SESSION_COOKIE, createSession(userId), sessionCookieOptions(!dev));
	}

	return resolve(event);
};
