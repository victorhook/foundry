import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getUserByName } from '$lib/server/db';
import { createSession, verifyPassword, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.userId) {
		throw redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const password = String(form.get('password') ?? '');

		const user = getUserByName(username);
		if (!user || !verifyPassword(password, user.password_hash)) {
			return fail(400, { error: 'Wrong username or password', username });
		}

		cookies.set(SESSION_COOKIE, createSession(user.id), sessionCookieOptions(!dev));
		throw redirect(303, '/');
	}
};
