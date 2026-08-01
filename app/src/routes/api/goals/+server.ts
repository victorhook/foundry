import { json, error } from '@sveltejs/kit';
import { createGoal, updateGoal, deleteGoal, getExercise } from '$lib/server/db';
import type { RequestHandler } from './$types';

const KINDS = ['weekly', 'exercise', 'generic'];

function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === '') { return null; }
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

// Create or update a goal.
// Body (create): { kind: 'weekly'|'exercise'|'generic', title, ... }
//   weekly:   target (workouts per week), filter (routine id, or null = any)
//   exercise: exerciseId, targetValue (kg / sec / reps), reps?, equipment?
// Body (update): { id, title?, target?, filter?, targetValue?, reps?, equipment?, done? }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	const title = String(b.title ?? '').trim();

	if (b.id) {
		const patch: Record<string, unknown> = {};
		if (b.title !== undefined) { patch.title = title; }
		if (b.target !== undefined) { patch.target = b.target == null ? null : Number(b.target); }
		if (b.filter !== undefined) { patch.filter = b.filter || null; }
		if (b.done !== undefined) { patch.done = !!b.done; }
		if (b.exerciseId !== undefined) { patch.exerciseId = b.exerciseId || null; }
		if (b.targetValue !== undefined) { patch.targetValue = numOrNull(b.targetValue); }
		if (b.reps !== undefined) { patch.reps = numOrNull(b.reps); }
		if (b.equipment !== undefined) { patch.equipment = b.equipment || null; }
		const out = updateGoal(String(b.id), patch);
		if (!out) { throw error(404, 'Not found'); }
		return json(out);
	}

	const kind = KINDS.includes(b.kind) ? b.kind : 'weekly';
	if (!title) { throw error(400, 'Title required'); }

	if (kind === 'weekly') {
		const target = Number(b.target);
		if (!Number.isFinite(target) || target < 1) { throw error(400, 'Target must be at least 1'); }
		return json(createGoal({ kind, title, target: Math.round(target), filter: b.filter || null }));
	}

	if (kind === 'exercise') {
		const exerciseId = String(b.exerciseId ?? '');
		if (!exerciseId || !getExercise(exerciseId)) { throw error(400, 'Unknown exercise'); }
		const targetValue = numOrNull(b.targetValue);
		if (targetValue == null || targetValue <= 0) { throw error(400, 'Target must be greater than 0'); }
		const reps = numOrNull(b.reps);
		return json(
			createGoal({
				kind,
				title,
				exerciseId,
				targetValue,
				reps: reps && reps > 0 ? Math.round(reps) : null,
				equipment: b.equipment || null
			})
		);
	}

	return json(createGoal({ kind, title }));
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteGoal(String(b.id));
	return json({ ok: true });
};
