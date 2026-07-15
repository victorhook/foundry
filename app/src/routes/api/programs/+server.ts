import { json, error } from '@sveltejs/kit';
import { createProgram, updateProgram, deleteProgram } from '$lib/server/db';
import { removeUpload } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const KINDS = ['program', 'rehab', 'event'];

// Create or update a program/rehab/event. Body:
// { id?, title, kind, startDate?, notes?, filename?, mime? }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const title = String(b.title ?? '').trim();
	if (!title) {
		throw error(400, 'Title required');
	}
	const kind = KINDS.includes(b.kind) ? b.kind : 'program';
	const p = {
		title,
		kind,
		startDate: b.startDate || null,
		notes: String(b.notes ?? ''),
		filename: b.filename !== undefined ? b.filename : undefined,
		mime: b.mime !== undefined ? b.mime : undefined
	};
	const out = b.id ? updateProgram(String(b.id), p) : createProgram(p);
	if (!out) {
		throw error(404, 'Not found');
	}
	return json(out);
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const row = deleteProgram(String(b.id));
	if (row && row.filename) {
		removeUpload(row.filename);
	}
	return json({ ok: true });
};
