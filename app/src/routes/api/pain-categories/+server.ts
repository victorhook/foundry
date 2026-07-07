import { json, error } from '@sveltejs/kit';
import { createPainCategory } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const name = String(body.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	return json({ name: createPainCategory(name) });
};
