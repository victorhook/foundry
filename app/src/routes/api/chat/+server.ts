import { json, error } from '@sveltejs/kit';
import { getChats, getChat, createChat, renameChat, deleteChat } from '$lib/server/db';
import { claudeAvailable } from '$lib/server/claude';
import type { RequestHandler } from './$types';

// Chat list / single transcript. The turn itself streams from ./stream.

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId || !locals.viaCookie) {
		// Chat transcripts can contain command output and file contents, so the
		// read-only API_TOKEN (which grants every other GET) is not enough here.
		throw error(401, 'Not authenticated');
	}
	const id = url.searchParams.get('id');
	if (id) {
		const chat = getChat(id);
		if (!chat) {
			throw error(404, 'Not found');
		}
		return json(chat);
	}
	return json({ chats: getChats(), available: claudeAvailable() });
};

// Create a chat, or rename an existing one. Body: { id?, title? }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId || !locals.viaCookie) {
		// Chat transcripts can contain command output and file contents, so the
		// read-only API_TOKEN (which grants every other GET) is not enough here.
		throw error(401, 'Not authenticated');
	}
	const b = await request.json().catch(() => ({}) as any);
	if (b.id) {
		const title = String(b.title ?? '').trim();
		if (!title) {
			throw error(400, 'Title required');
		}
		const out = renameChat(String(b.id), title);
		if (!out) {
			throw error(404, 'Not found');
		}
		return json(out);
	}
	return json(createChat(b.title ? String(b.title) : undefined));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId || !locals.viaCookie) {
		// Chat transcripts can contain command output and file contents, so the
		// read-only API_TOKEN (which grants every other GET) is not enough here.
		throw error(401, 'Not authenticated');
	}
	const b = await request.json().catch(() => ({}) as any);
	if (!b.id) {
		throw error(400, 'id required');
	}
	deleteChat(String(b.id));
	return json({ ok: true });
};
