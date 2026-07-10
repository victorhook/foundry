import { json, error } from '@sveltejs/kit';
import { addBodyWeight, deleteBodyWeight } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const weight = Number(b.weight);
	if (!weight || weight <= 0) {
		throw error(400, 'Valid weight required');
	}
	const at = Number(b.at) || Date.now();
	return json(addBodyWeight(at, weight));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteBodyWeight(Number(b.id));
	return json({ ok: true });
};
