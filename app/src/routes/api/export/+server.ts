import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getExercises,
	getWorkouts,
	getBodyWeights,
	getStepDays,
	getNotes,
	getPainNotes,
	getGoals,
	getPrograms,
	getProfile,
	getFoodLogRange
} from '$lib/server/db';
import { buildDigest, digestData, rangeOfDays, DIGEST_VERSION } from '$lib/server/digest';
import { localDay } from '$lib/server/snapshot';
import type { RequestHandler } from './$types';

const MAX_DAYS = 3650;

// A ranged digest of everything logged, for handing to an AI agent.
//   /api/export?weeks=2            → the last 14 days as text (the default form)
//   /api/export?days=90&format=json
//   /api/export?from=2026-01-01&to=2026-03-31
// Text is sectioned TSV (see $lib/server/digest); JSON is the same filtered data
// as objects.
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const now = Date.now();
	const tz = env.TZ;
	const today = localDay(now, tz);

	const num = (name: string) => {
		const raw = url.searchParams.get(name);
		if (raw === null) { return null; }
		const n = Number(raw);
		if (!Number.isFinite(n) || n <= 0) { throw error(400, `${name} must be a positive number`); }
		return Math.floor(n);
	};
	const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const weeks = num('weeks');
	const days = num('days');

	let range;
	if (from || to) {
		// An explicit window: either bound may be left open, but what's given must
		// be a plain calendar day — a half-parsed date would silently shift results.
		if ((from && !isDay(from)) || (to && !isDay(to))) {
			throw error(400, 'from/to must be YYYY-MM-DD');
		}
		range = { from: from || '0000-01-01', to: to || today };
		if (range.from > range.to) { throw error(400, 'from must not be after to'); }
	} else if (days || weeks) {
		range = rangeOfDays(today, Math.min(MAX_DAYS, days || weeks! * 7));
	} else {
		range = rangeOfDays(today, 7);
	}

	const sources = {
		now,
		timezone: tz,
		range,
		exercises: getExercises(),
		workouts: getWorkouts(),
		bodyWeights: getBodyWeights(),
		steps: getStepDays(),
		notes: getNotes(),
		painNotes: getPainNotes(),
		goals: getGoals(),
		programs: getPrograms().map((p) => ({
			id: p.id,
			kind: p.kind,
			title: p.title,
			startDate: p.startDate,
			notes: p.notes
		})),
		profile: getProfile(),
		foodLog: getFoodLogRange(range.from, range.to)
	};

	const stamp = `${range.from}_${range.to}`;
	if (url.searchParams.get('format') === 'json') {
		const data = digestData(sources);
		return json(
			{ version: DIGEST_VERSION, generatedAt: new Date(now).toISOString(), today, timezone: tz ?? null, ...data,
				goals: sources.goals, programs: sources.programs, profile: sources.profile },
			{ headers: { 'content-disposition': `attachment; filename="foundry-${stamp}.json"` } }
		);
	}
	return new Response(buildDigest(sources), {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="foundry-${stamp}.txt"`,
			'cache-control': 'no-store'
		}
	});
};
