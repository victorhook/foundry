import { json, error } from '@sveltejs/kit';
import { addPhoto, deletePhoto } from '$lib/server/db';
import { saveUpload, removeUpload } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB (client downscales, so this is a ceiling)
const EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

function rid() {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// multipart/form-data: file + optional albumId, caption, tags (csv), takenAt
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) {
		throw error(400, 'No file');
	}
	const mime = file.type;
	if (!EXT[mime]) {
		throw error(400, 'Unsupported image type');
	}
	const buf = Buffer.from(await file.arrayBuffer());
	if (buf.byteLength > MAX_BYTES) {
		throw error(413, 'Image too large');
	}
	const filename = `${rid()}.${EXT[mime]}`;
	await saveUpload(filename, buf);

	const tags = String(form.get('tags') || '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	const albumId = form.get('albumId') ? String(form.get('albumId')) : null;
	const caption = String(form.get('caption') || '');
	const takenAt = form.get('takenAt') ? Number(form.get('takenAt')) : null;

	return json(addPhoto({ albumId, filename, mime, caption, tags, takenAt }));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const row = deletePhoto(String(b.id));
	if (row) {
		removeUpload(row.filename);
	}
	return json({ ok: true });
};
