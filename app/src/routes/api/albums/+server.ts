import { json, error } from '@sveltejs/kit';
import { createAlbum, deleteAlbum } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const name = String(b.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	return json(createAlbum(name));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteAlbum(String(b.id));
	return json({ ok: true });
};
