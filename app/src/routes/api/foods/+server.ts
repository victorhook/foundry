import { json, error } from '@sveltejs/kit';
import { createFood, updateFood, deleteFood } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Create or update a food. Body: { id?, name, serving?, kcal, protein, carbs, fat }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const name = String(b.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	// kcal/protein/carbs/fat are per 100 g.
	const f = { name, image: b.image ?? null, kcal: b.kcal, protein: b.protein, carbs: b.carbs, fat: b.fat };
	return json(b.id ? updateFood(String(b.id), f) : createFood(f));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteFood(String(b.id));
	return json({ ok: true });
};
