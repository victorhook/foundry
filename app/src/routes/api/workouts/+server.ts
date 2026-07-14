import { json, error } from '@sveltejs/kit';
import { createWorkout, updateWorkout } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const workout = {
		startedAt: Number(body.startedAt) || Date.now(),
		routineName: body.routineName ?? null,
		theme: body.theme ?? null,
		feel: body.feel ?? null,
		energy: body.energy ?? null,
		notes: String(body.notes ?? ''),
		entries: Array.isArray(body.entries) ? body.entries : [],
		pains: Array.isArray(body.pains) ? body.pains : []
	};
	return json(createWorkout(workout));
};

// Edit an existing workout's date and/or theme. Body: { id, startedAt?, theme? }
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const id = String(b.id ?? '');
	if (!id) {
		throw error(400, 'id required');
	}
	const patch: { startedAt?: number; theme?: string | null } = {};
	if (b.startedAt != null) { patch.startedAt = Number(b.startedAt); }
	if (b.theme !== undefined) { patch.theme = b.theme; }
	const updated = updateWorkout(id, patch);
	if (!updated) {
		throw error(404, 'Not found');
	}
	return json(updated);
};
