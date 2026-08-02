import { json, error } from '@sveltejs/kit';
import { getAgentMemory, setAgentMemory } from '$lib/server/db';
import type { RequestHandler } from './$types';

// The AI chat agent's cross-chat memory (one curated markdown doc). The agent
// updates it itself via the save_memory MCP tool; this route lets the owner read
// and edit it directly from the chat UI (view / correct / wipe).

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	return json({ content: getAgentMemory() });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const body = await request.json();
	const content = String(body.content ?? '');
	if (content.length > 20000) {
		throw error(400, 'Memory is too long (max 20000 characters).');
	}
	setAgentMemory(content);
	return json({ ok: true, content });
};
