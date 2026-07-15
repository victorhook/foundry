import { json, error } from '@sveltejs/kit';
import { getFoodLog, addFoodLog, updateFoodLog, deleteFoodLog } from '$lib/server/db';
import type { RequestHandler } from './$types';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/nutrition?day=YYYY-MM-DD → that day's diary entries.
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const day = url.searchParams.get('day') || '';
	if (!DAY_RE.test(day)) {
		throw error(400, 'Bad day');
	}
	return json(getFoodLog(day));
};

// POST: add one or more entries to a day/slot.
// Body: { day, slot, entries: [{foodId?, qty, name, kcal, protein, carbs, fat}] }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	if (!DAY_RE.test(String(b.day))) {
		throw error(400, 'Bad day');
	}
	const slot = String(b.slot || 'snack');
	// entries carry per-100g macros + grams (foods) or direct totals (quick add).
	const entries = Array.isArray(b.entries) ? b.entries.filter((e: any) => e && e.name) : [];
	if (!entries.length) {
		throw error(400, 'No entries');
	}
	return json(addFoodLog(String(b.day), slot, entries));
};

// PUT: edit one entry. Body: { id, qty?, slot?, name?, kcal?, protein?, carbs?, fat? }
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const out = updateFoodLog(String(b.id), b);
	if (out === null) {
		throw error(404, 'Not found');
	}
	return json(out);
};

// DELETE: remove one entry. Body: { id }
export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	return json(deleteFoodLog(String(b.id)));
};
