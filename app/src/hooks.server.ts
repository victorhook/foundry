import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { SESSION_COOKIE, verifySession, createSession, sessionCookieOptions } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const userId = verifySession(token);
	event.locals.userId = userId;

	// Rolling session: every authenticated request resets the 30-day window, so
	// you stay logged in as long as you use the app at least once a month.
	if (userId !== null) {
		event.cookies.set(SESSION_COOKIE, createSession(userId), sessionCookieOptions(!dev));
	}

	return resolve(event);
};
