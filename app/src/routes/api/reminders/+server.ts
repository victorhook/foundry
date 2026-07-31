import { json, error } from '@sveltejs/kit';
import { createReminder, updateReminder, deleteReminder } from '$lib/server/db';
import type { RequestHandler } from './$types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Create or update a per-weekday reminder. Body: { id?, days, time, enabled? }
// `days` is a 7-bit mask (bit i => JS getDay()===i, 0=Sun..6=Sat). `time` = "HH:MM".
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	if (b.id) {
		const patch: { days?: number; time?: string; enabled?: boolean } = {};
		if (b.days !== undefined) { patch.days = Number(b.days) & 0x7f; }
		if (b.time !== undefined) {
			if (!TIME_RE.test(String(b.time))) { throw error(400, 'Bad time'); }
			patch.time = String(b.time);
		}
		if (b.enabled !== undefined) { patch.enabled = !!b.enabled; }
		const out = updateReminder(String(b.id), patch);
		if (!out) { throw error(404, 'Not found'); }
		return json(out);
	}
	const days = Number(b.days) & 0x7f;
	const time = String(b.time ?? '');
	if (!days) { throw error(400, 'Pick at least one day'); }
	if (!TIME_RE.test(time)) { throw error(400, 'Bad time'); }
	const out = createReminder({ days, time, enabled: b.enabled !== false });
	if (!out) { throw error(404, 'Not found'); }
	return json(out);
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json();
	deleteReminder(String(b.id));
	return json({ ok: true });
};
