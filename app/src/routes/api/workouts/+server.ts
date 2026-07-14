import { json, error } from '@sveltejs/kit';
import { createWorkout, updateWorkoutDate } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const workout = {
		startedAt: Number(body.startedAt) || Date.now(),
		routineName: body.routineName ?? null,
		feel: body.feel ?? null,
		energy: body.energy ?? null,
		notes: String(body.notes ?? ''),
		entries: Array.isArray(body.entries) ? body.entries : [],
		pains: Array.isArray(body.pains) ? body.pains : []
	};
	return json(createWorkout(workout));
};

// Change the date of an existing workout. Body: { id, startedAt }
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const id = String(b.id ?? '');
	const startedAt = Number(b.startedAt);
	if (!id || !startedAt) {
		throw error(400, 'id and startedAt required');
	}
	const updated = updateWorkoutDate(id, startedAt);
	if (!updated) {
		throw error(404, 'Not found');
	}
	return json(updated);
};
