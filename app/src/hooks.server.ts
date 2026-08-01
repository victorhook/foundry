import crypto from 'node:crypto';
import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { SESSION_COOKIE, verifySession, createSession, sessionCookieOptions } from '$lib/server/auth';
import { getFirstUserId } from '$lib/server/db';
import { startScheduler } from '$lib/server/scheduler';

// Kick off the in-process reminder scheduler once, at server start. No-op during
// build analysis or when Web Push isn't configured.
startScheduler();

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

	// Automation/read API: a bearer token grants READ-ONLY access as the single
	// app user. Enabled by setting API_TOKEN; no session cookie is issued for
	// these requests. See docs/api.md.
	//
	// GET only, with one exception: /mcp is JSON-RPC and so must be POSTed. Every
	// tool it exposes is a query (see $lib/server/mcp), and no other POST route
	// is reachable this way, so the token still can't change anything.
	const bearerAllowed =
		event.request.method === 'GET' ||
		(event.request.method === 'POST' && event.url.pathname.replace(/\/$/, '') === '/mcp');
	if (userId === null && bearerAllowed) {
		const apiToken = env.API_TOKEN;
		const auth = event.request.headers.get('authorization');
		if (apiToken && auth && safeEqual(auth, `Bearer ${apiToken}`)) {
			userId = getFirstUserId();
		}
	}

	event.locals.userId = userId;
	event.locals.viaCookie = viaCookie;

	// Rolling session: every authenticated *browser* request resets the 30-day
	// window. Bearer (API) requests never get a cookie.
	if (viaCookie && userId !== null) {
		event.cookies.set(SESSION_COOKIE, createSession(userId), sessionCookieOptions(!dev));
	}

	return resolve(event);
};
