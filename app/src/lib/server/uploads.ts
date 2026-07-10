import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';

// Photo files live outside the DB. Defaults next to the SQLite file under data/.
export const UPLOAD_DIR = env.UPLOAD_DIR || 'data/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export function uploadPath(filename: string) {
	// Guard against path traversal — only a bare filename is ever valid.
	return path.join(UPLOAD_DIR, path.basename(filename));
}

export async function saveUpload(filename: string, bytes: Buffer) {
	await fs.promises.writeFile(uploadPath(filename), bytes);
}

export function removeUpload(filename: string) {
	try {
		fs.unlinkSync(uploadPath(filename));
	} catch {
		/* already gone */
	}
}
