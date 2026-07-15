import { json, error } from '@sveltejs/kit';
import { createNote, updateNote, deleteNote } from '$lib/server/db';
import type { RequestHandler } from './$types';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Create or update a date-bound note. Body: { id?, day, text }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const day = String(b.day ?? '');
	if (!DAY_RE.test(day)) {
		throw error(400, 'Bad day');
	}
	const text = String(b.text ?? '').trim();
	if (!text) {
		throw error(400, 'Text required');
	}
	const out = b.id ? updateNote(String(b.id), { day, text }) : createNote(day, text);
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
	deleteNote(String(b.id));
	return json({ ok: true });
};
