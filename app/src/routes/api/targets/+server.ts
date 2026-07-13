import { json, error } from '@sveltejs/kit';
import { saveTargets } from '$lib/server/db';
import type { RequestHandler } from './$types';

const n = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

// Save daily nutrition targets. Body: { kcal, protein, carbs, fat }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	return json(saveTargets({ kcal: n(b.kcal), protein: n(b.protein), carbs: n(b.carbs), fat: n(b.fat) }));
};
