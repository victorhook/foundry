import { json, error } from '@sveltejs/kit';
import { saveMeal, deleteMeal, getMealSlots } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Create or update a saved meal. Body: { id?, name, icon?, servings?, items: [{foodId, qty, name, kcal, protein, carbs, fat}] }
// `servings` is how many portions the items add up to (batch cooking) — 1 unless said otherwise.
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
					grams: it.grams ?? null,
					qty: it.qty ?? 1,
					name: String(it.name),
					kcal: it.kcal,
					protein: it.protein,
					carbs: it.carbs,
					fat: it.fat
				}))
		: [];
	// Meal sections are user-editable, so the default slot is checked against the
	// live list rather than a fixed breakfast/lunch/dinner/snack.
	const slots = getMealSlots().map((s) => s.id);
	const servings = Math.max(1, Math.min(99, Math.round(Number(b.servings) || 1)));
	return json(
		saveMeal({
			id: b.id ? String(b.id) : undefined,
			name,
			icon: b.icon ?? null,
			everyday: !!b.everyday,
			slot: slots.includes(b.slot) ? b.slot : null,
			servings,
			items
		})
	);
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteMeal(String(b.id));
	return json({ ok: true });
};
