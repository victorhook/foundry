import { json, error } from '@sveltejs/kit';
import { saveUpload } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB (covers a downscaled image or a PDF)
const EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'application/pdf': 'pdf'
};

function rid() {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Generic authenticated upload → returns { filename, mime } for exercise images
// and program documents. multipart/form-data with a `file` field.
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
		throw error(400, 'Unsupported file type');
	}
	const buf = Buffer.from(await file.arrayBuffer());
	if (buf.byteLength > MAX_BYTES) {
		throw error(413, 'File too large');
	}
	const filename = `${rid()}.${EXT[mime]}`;
	await saveUpload(filename, buf);
	return json({ filename, mime });
};
