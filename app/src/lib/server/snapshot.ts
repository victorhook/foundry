// Shape of the data export handed to the AI chat agent. Pure — no database, no
// filesystem — so the shape and (crucially) the date arithmetic are unit-testable
// without opening SQLite. The writer lives in ./snapshot-write.

export const SNAPSHOT_FILE = 'foundry-data.json';

/** How much of the food diary to include. Older days are rarely asked about. */
export const NUTRITION_DAYS = 60;

/** Short weekday ("Mon") in the given zone. */
export function localWeekday(ts: number, tz?: string): string {
	return new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, weekday: 'short' }).format(
		new Date(ts)
	);
}

/** 24h clock ("18:00") in the given zone. */
export function localTime(ts: number, tz?: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: tz || undefined,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(new Date(ts));
}

/**
 * Total load moved in a strength entry, in kg. Null when the numbers don't mean
 * kilograms: a "sec" unit puts seconds in the weight field, and a bodyweight
 * exercise logs no external load at all.
 */
export function entryVolumeKg(sets: any[], ex: any): number | null {
	if (!ex || ex.type !== 'strength' || ex.unit === 'sec' || ex.bodyweight) { return null; }
	let total = 0;
	let counted = 0;
	for (const s of sets || []) {
		if (typeof s?.reps === 'number' && typeof s?.weight === 'number') {
			total += s.reps * s.weight;
			counted++;
		}
	}
	return counted ? Math.round(total * 10) / 10 : null;
}

/**
 * Turn one stored workout into something answerable without shell arithmetic:
 * calendar fields already in the user's zone, exercise names already resolved,
 * and the totals a "how did this week go" question needs.
 */
export function enrichWorkout(w: any, exById: Map<string, any>, tz?: string) {
	const day = localDay(w.startedAt, tz);
	let volumeKg: number | null = null;
	let durationMin: number | null = null;
	let distanceKm: number | null = null;

	const exercises = (w.entries || []).map((e: any) => {
		const ex = exById.get(e.exerciseId);
		const v = entryVolumeKg(e.sets, ex);
		if (v !== null) { volumeKg = (volumeKg ?? 0) + v; }
		for (const s of e.sets || []) {
			if (typeof s?.duration === 'number') { durationMin = (durationMin ?? 0) + s.duration; }
			if (typeof s?.distance === 'number') { distanceKm = (distanceKm ?? 0) + s.distance; }
		}
		return {
			name: ex ? ex.name : e.exerciseId,
			type: ex ? ex.type : null,
			unit: ex ? ex.unit : null,
			bodyweight: ex ? !!ex.bodyweight : false,
			muscles: ex ? ex.muscles : [],
			sets: e.sets,
			setCount: (e.sets || []).length,
			volumeKg: v,
			note: e.note || '',
			pain: e.pain ?? null
		};
	});

	return {
		id: w.id,
		day,
		weekday: localWeekday(w.startedAt, tz),
		time: localTime(w.startedAt, tz),
		weekStartMonday: mondayOf(day),
		startedAt: w.startedAt,
		routineName: w.routineName,
		theme: w.theme ?? null,
		feel: w.feel,
		energy: w.energy,
		notes: w.notes || '',
		pains: w.pains || [],
		volumeKg: volumeKg === null ? null : Math.round((volumeKg as number) * 10) / 10,
		durationMin,
		distanceKm: distanceKm === null ? null : Math.round((distanceKm as number) * 100) / 100,
		exercises
	};
}

export function localDay(ts: number, tz?: string): string {
	// en-CA gives YYYY-MM-DD. TZ comes from the app's env (set on the server so
	// days line up with the user's calendar, not UTC).
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz || undefined,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(ts));
}

/** Monday of the week containing `day` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function mondayOf(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
	dt.setUTCDate(dt.getUTCDate() - dow);
	return dt.toISOString().slice(0, 10);
}

/** The last `n` calendar days ending at `today`, oldest first. */
export function recentDays(today: string, n: number): string[] {
	const [y, m, d] = today.split('-').map(Number);
	const end = Date.UTC(y, m - 1, d);
	const out: string[] = [];
	for (let i = n - 1; i >= 0; i--) {
		out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
	}
	return out;
}

type SnapshotSources = {
	now: number;
	timezone?: string;
	exercises: unknown[];
	workouts: unknown[];
	bodyWeights: unknown[];
	steps: unknown[];
	notes: unknown[];
	goals: unknown[];
	profile: any;
	/** Food-diary entries per day, keyed YYYY-MM-DD. Empty days are dropped. */
	foodLog: Record<string, unknown[]>;
	counts: Record<string, number>;
};

/**
 * Assemble the snapshot object. Pure — takes the data rather than reading the
 * DB — so the shape and the derived date fields are unit-testable.
 */
export function buildSnapshot(s: SnapshotSources) {
	const today = localDay(s.now, s.timezone);
	const weekStart = mondayOf(today);
	const exById = new Map((s.exercises as any[]).map((e: any) => [e.id, e]));
	// Enriched here rather than by the agent: it was spending most of a turn
	// converting epoch timestamps with `date -d`, joining exercise ids to names,
	// and shelling out to python to sum sets.
	const workouts = (s.workouts as any[]).map((w) => enrichWorkout(w, exById, s.timezone));
	const thisWeek = workouts.filter((w) => w.day >= weekStart);
	const nutritionDays = Object.entries(s.foodLog)
		.filter(([, entries]) => entries.length > 0)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([day, entries]) => ({ day, entries }));

	// Sizes first, so the agent can judge whether reading a whole collection is
	// sensible before it does. Full workout history is kept (progress questions
	// span years), which means this file grows — roughly 2 KB per logged session.
	const counts: Record<string, number> = {
		workouts: workouts.length,
		workoutsThisWeek: thisWeek.length,
		exercises: s.exercises.length,
		bodyWeights: s.bodyWeights.length,
		stepDays: s.steps.length,
		notes: s.notes.length,
		goals: s.goals.length,
		nutritionDays: nutritionDays.length,
		...s.counts
	};

	return {
		_readme: [
			'Foundry data export, rewritten before every chat turn. Read-only: editing',
			'this file changes nothing in the app.',
			'',
			'EVERYTHING IS PRE-COMPUTED. You should not need date arithmetic, id joins,',
			'or a scratch script — if you find yourself running `date`, resolving an',
			'exerciseId, or summing sets by hand, re-read this list first.',
			'',
			'Per workout, already in the user\'s timezone: `day` (YYYY-MM-DD), `weekday`',
			'("Mon"), `time` ("18:00"), `weekStartMonday`. Also `volumeKg` (total load',
			'moved), `durationMin` and `distanceKm` for cardio, and `exercises[]` with',
			'names ALREADY RESOLVED — no lookup against exercises[] needed. Each has',
			'{ name, type, unit, bodyweight, muscles, sets, setCount, volumeKg, note,',
			'pain }. Strength sets are { reps, weight }; cardio { duration, distance,',
			'pace }. volumeKg is null where kilograms are meaningless: a "sec" unit puts',
			'seconds in the weight field, and bodyweight exercises log no external load.',
			'',
			'Top level: `today`, `weekStartMonday` (this week\'s Monday), `counts` (sizes,',
			'including workoutsThisWeek). Compare a workout\'s `day` against',
			'`weekStartMonday` as plain strings — that is a correct week filter.',
			'',
			'nutrition.days[].entries[]: { slot, name, grams, qty, kcal, protein, carbs,',
			`fat } — totals per entry, not per 100 g. Last ${NUTRITION_DAYS} days only.`,
			'',
			'Absent data means not recorded, not zero. No photos or identifiers beyond',
			'what is listed here.'
		].join('\n'),
		// Copy-pasteable so a common question costs one command, not fifteen. `jq`
		// and `python3` are both installed; there is no need to check.
		_recipes: {
			thisWeek: "jq '[.workouts[] | select(.day >= $ws)] ' --arg ws \"$(jq -r .weekStartMonday foundry-data.json)\" foundry-data.json",
			thisWeekCompact:
				"jq --arg ws \"$(jq -r .weekStartMonday foundry-data.json)\" '[.workouts[] | select(.day >= $ws) | {weekday, day, routineName, feel, energy, volumeKg, notes, exercises: [.exercises[] | {name, sets}]}]' foundry-data.json",
			lastNWorkouts: "jq '.workouts[-5:]' foundry-data.json",
			oneExerciseOverTime:
				"jq --arg name 'Bench Press' '[.workouts[] | {day, sets: [.exercises[] | select(.name == $name) | .sets]} | select(.sets | length > 0)]' foundry-data.json",
			weeklyVolume:
				"jq '[.workouts[] | {w: .weekStartMonday, v: .volumeKg}] | group_by(.w) | map({week: .[0].w, volumeKg: (map(.v // 0) | add), sessions: length})' foundry-data.json",
			bodyWeightTrend: "jq '.bodyWeights[-14:]' foundry-data.json",
			nutritionRecentDays: "jq '.nutrition.days[-7:]' foundry-data.json"
		},
		generatedAt: new Date(s.now).toISOString(),
		today,
		weekStartMonday: mondayOf(today),
		timezone: s.timezone || 'unset (server default)',
		profile: s.profile,
		exercises: s.exercises,
		workouts,
		bodyWeights: s.bodyWeights,
		steps: s.steps,
		notes: s.notes,
		goals: s.goals,
		nutrition: { targets: s.profile?.targets ?? null, days: nutritionDays },
		counts
	};
}
