import { json, error } from '@sveltejs/kit';
import { saveMeal, deleteMeal } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Create or update a saved meal. Body: { id?, name, icon?, items: [{foodId, qty, name, kcal, protein, carbs, fat}] }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const name = String(b.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	const items = Array.isArray(b.items)
		? b.items
				.filter((it: any) => it && it.name)
				.map((it: any) => ({
					foodId: it.foodId ?? null,
					qty: it.qty ?? 1,
					name: String(it.name),
					kcal: it.kcal,
					protein: it.protein,
					carbs: it.carbs,
					fat: it.fat
				}))
		: [];
	return json(saveMeal({ id: b.id ? String(b.id) : undefined, name, icon: b.icon ?? null, items }));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteMeal(String(b.id));
	return json({ ok: true });
};
