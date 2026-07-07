import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.userId = verifySession(token);
	return resolve(event);
};
