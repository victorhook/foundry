import { json, error } from '@sveltejs/kit';
import { createPainCategory, renamePainCategory, deletePainCategory } from '$lib/server/db';
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

// Rename an area, rewriting every logged occurrence. Renaming onto a name that
// already exists merges the two (the response says so).
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const from = String(body.from ?? '').trim();
	const to = String(body.to ?? '').trim();
	if (!from || !to) {
		throw error(400, 'from and to are required');
	}
	if (from === to) {
		return json({ name: to, merged: false });
	}
	const out = renamePainCategory(from, to);
	if (!out) {
		throw error(404, 'Unknown pain area');
	}
	return json(out);
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const name = String(body.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	deletePainCategory(name);
	return json({ ok: true });
};
