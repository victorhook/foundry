import { json, error } from '@sveltejs/kit';
import {
	createMealSlot,
	renameMealSlot,
	reorderMealSlots,
	deleteMealSlot,
	getMealSlots
} from '$lib/server/db';
import type { RequestHandler } from './$types';

// The daily diary's meal sections (Breakfast, Lunch, …) — a user-editable,
// ordered list. Read via /api/data (`mealSlots`); this route mutates it.

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const name = String(body.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	return json(createMealSlot(name.slice(0, 40)));
};

// Two shapes: { order: [id, …] } reorders; { id, name } renames.
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	if (Array.isArray(body.order)) {
		return json({ ok: true, slots: reorderMealSlots(body.order.map(String)) });
	}
	const id = String(body.id ?? '').trim();
	const name = String(body.name ?? '').trim();
	if (!id || !name) {
		throw error(400, 'id and name are required');
	}
	const out = renameMealSlot(id, name.slice(0, 40));
	if (!out) {
		throw error(404, 'Unknown meal section');
	}
	return json(out);
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const id = String(body.id ?? '').trim();
	if (!id) {
		throw error(400, 'id required');
	}
	const res = deleteMealSlot(id);
	if (!res.ok) {
		throw error(400, 'Cannot delete the last meal section');
	}
	return json({ ...res, slots: getMealSlots() });
};
