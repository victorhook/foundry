import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import { getPhotoFile } from '$lib/server/db';
import { uploadPath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

// Serves a photo's bytes — auth-gated, since progress photos are private.
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const row = getPhotoFile(params.id);
	if (!row) {
		throw error(404, 'Not found');
	}
	const p = uploadPath(row.filename);
	if (!fs.existsSync(p)) {
		throw error(404, 'File missing');
	}
	const data = await fs.promises.readFile(p);
	return new Response(data, {
		headers: {
			'content-type': row.mime || 'application/octet-stream',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
