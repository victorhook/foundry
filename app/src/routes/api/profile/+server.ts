import { json, error } from '@sveltejs/kit';
import { saveProfile } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const dob = b.dob ? String(b.dob) : null;
	const height = b.height != null && b.height !== '' ? Number(b.height) : null;
	const gender = b.gender ? String(b.gender) : null;
	return json(saveProfile({ dob, height, gender }));
};
