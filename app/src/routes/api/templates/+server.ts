import { json, error } from '@sveltejs/kit';
import { saveTemplate, deleteTemplate } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Create or update a template. Body: { id?, name, icon?, entries: [{exerciseId, setCount, reps, weight}] }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const name = String(b.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	const entries = Array.isArray(b.entries)
		? b.entries
				.filter((e: any) => e && e.exerciseId)
				.map((e: any) => ({
					exerciseId: String(e.exerciseId),
					setCount: e.setCount != null ? Number(e.setCount) : null,
					reps: e.reps != null ? Number(e.reps) : null,
					weight: e.weight != null ? Number(e.weight) : null
				}))
		: [];
	return json(saveTemplate({ id: b.id ? String(b.id) : undefined, name, icon: b.icon ?? null, entries }));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteTemplate(String(b.id));
	return json({ ok: true });
};
