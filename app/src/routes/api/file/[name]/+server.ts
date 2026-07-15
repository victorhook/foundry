import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { uploadPath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const MIME: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	pdf: 'application/pdf'
};

// Serves an uploaded file (exercise image / program document) by bare filename.
// Auth-gated; uploadPath() strips any path so traversal isn't possible.
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const name = path.basename(params.name);
	if (!name || name !== params.name) {
		throw error(400, 'Bad name');
	}
	const p = uploadPath(name);
	if (!fs.existsSync(p)) {
		throw error(404, 'File missing');
	}
	const ext = name.split('.').pop()?.toLowerCase() || '';
	const data = await fs.promises.readFile(p);
	return new Response(data, {
		headers: {
			'content-type': MIME[ext] || 'application/octet-stream',
			'content-disposition': 'inline',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
