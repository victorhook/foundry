import { json, error } from '@sveltejs/kit';
import { getAllData } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	return json(getAllData());
};
