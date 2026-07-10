import { json, error } from '@sveltejs/kit';
import { createExercise, updateExercise } from '$lib/server/db';
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
	const muscles = parseMuscles(body);
	const bodyweight = !!body.bodyweight;
	const unit = body.unit === 'sec' ? 'sec' : 'kg';
	if (body.id) {
		return json(updateExercise(String(body.id), name, muscles, bodyweight, unit));
	}
	return json(createExercise(name, muscles, bodyweight, unit));
};
