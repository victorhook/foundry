import { json, error } from '@sveltejs/kit';
import { createPainNote, updatePainNote, deletePainNote, type PainItem } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Normalize the incoming items into [{cat, level}] with level clamped to 1-10.
// Drops entries without a category. Levels round to the nearest integer.
function parseItems(raw: unknown): PainItem[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: PainItem[] = [];
	for (const it of raw) {
		const cat = String((it && it.cat) ?? '').trim();
		if (!cat) {
			continue;
		}
		let level = Math.round(Number((it && it.level) ?? 0));
		if (!Number.isFinite(level)) {
			level = 1;
		}
		level = Math.max(1, Math.min(10, level));
		out.push({ cat, level });
	}
	return out;
}

// Create or update a standalone pain note. Body: { id?, at?, note?, items:[{cat,level}] }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const items = parseItems(b.items);
	const note = String(b.note ?? '');
	if (!items.length && !note.trim()) {
		throw error(400, 'A pain note needs at least one area or a note');
	}
	const at = b.at != null ? Number(b.at) : undefined;
	const out = b.id
		? updatePainNote(String(b.id), { at, note, items })
		: createPainNote({ at, note, items });
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
	deletePainNote(String(b.id));
	return json({ ok: true });
};
