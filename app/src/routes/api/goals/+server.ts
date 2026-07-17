import { json, error } from '@sveltejs/kit';
import { createGoal, updateGoal, deleteGoal } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Create or update a goal.
// Body (create): { kind: 'weekly'|'generic', title, target?, filter? }
// Body (update): { id, title?, target?, filter?, done? }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const title = String(b.title ?? '').trim();

	if (b.id) {
		const patch: { title?: string; target?: number | null; filter?: string | null; done?: boolean } = {};
		if (b.title !== undefined) { patch.title = title; }
		if (b.target !== undefined) { patch.target = b.target == null ? null : Number(b.target); }
		if (b.filter !== undefined) { patch.filter = b.filter || null; }
		if (b.done !== undefined) { patch.done = !!b.done; }
		const out = updateGoal(String(b.id), patch);
		if (!out) { throw error(404, 'Not found'); }
		return json(out);
	}

	const kind = b.kind === 'generic' ? 'generic' : 'weekly';
	if (!title) { throw error(400, 'Title required'); }
	if (kind === 'weekly') {
		const target = Number(b.target);
		if (!Number.isFinite(target) || target < 1) { throw error(400, 'Target must be at least 1'); }
		const out = createGoal({ kind, title, target: Math.round(target), filter: b.filter || null });
		return json(out);
	}
	const out = createGoal({ kind, title });
	return json(out);
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteGoal(String(b.id));
	return json({ ok: true });
};
