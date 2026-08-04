import { json, error } from '@sveltejs/kit';
import { createExercise, updateExercise, deleteExercise, exerciseUsage } from '$lib/server/db';
import { cleanEquipment } from '$lib/equipment';
import type { RequestHandler } from './$types';

function parseMuscles(body: any): string[] {
	if (Array.isArray(body.muscles)) {
		return body.muscles.map((m: unknown) => String(m)).filter((m: string) => m.trim());
	}
	// Back-compat: a single `muscle` string.
	return body.muscle ? [String(body.muscle)] : [];
}

// Create a new exercise, or update an existing one when `id` is present.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const name = String(body.name ?? '').trim();
	if (!name) {
		throw error(400, 'Name required');
	}
	const input = {
		name,
		muscles: parseMuscles(body),
		bodyweight: !!body.bodyweight,
		unit: body.unit === 'sec' ? 'sec' : 'kg',
		image: body.image ? String(body.image) : null,
		// Equipment options this movement can be performed with (unknown ids drop).
		equipment: cleanEquipment(body.equipment),
		unilateral: !!body.unilateral
	};
	if (body.id) {
		return json(updateExercise(String(body.id), input));
	}
	return json(createExercise(input));
};

// Remove a custom exercise and every reference to it (logged entries, template
// rows, PB goals). The caller gets the counts back so it knows what went.
export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const id = String(body.id ?? '');
	if (!id) {
		throw error(400, 'id required');
	}
	const usage = exerciseUsage(id);
	if (!deleteExercise(id)) {
		// Unknown id, or one of the server-seeded cardio movements.
		throw error(400, 'Exercise cannot be removed');
	}
	return json({ ok: true, removed: usage });
};
