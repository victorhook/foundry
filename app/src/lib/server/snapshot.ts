// Shape of the data export handed to the AI chat agent. Pure — no database, no
// filesystem — so the shape and (crucially) the date arithmetic are unit-testable
// without opening SQLite. The writer lives in ./snapshot-write.

export const SNAPSHOT_FILE = 'foundry-data.json';

/** How much of the food diary to include. Older days are rarely asked about. */
export const NUTRITION_DAYS = 60;

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
	const nutritionDays = Object.entries(s.foodLog)
		.filter(([, entries]) => entries.length > 0)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([day, entries]) => ({ day, entries }));

	// Sizes first, so the agent can judge whether reading a whole collection is
	// sensible before it does. Full workout history is kept (progress questions
	// span years), which means this file grows — roughly 2 KB per logged session.
	const counts: Record<string, number> = {
		workouts: s.workouts.length,
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
			'Dates: `today` and `weekStartMonday` are already in the user\'s timezone —',
			'use them instead of computing "now" yourself. Workout `startedAt` and',
			'body-weight `at` are epoch milliseconds; day-keyed data uses YYYY-MM-DD.',
			'',
			'workouts[]: { startedAt, routineName, theme, feel, energy (1-10 self-report),',
			'notes, pains[{cat,level}], entries[] }. An entry is { exerciseId, sets[],',
			'note, pain }. Strength sets are { reps, weight }; cardio sets are',
			'{ duration (minutes), distance (km), pace }. Resolve exerciseId against',
			'exercises[] for the name, type, muscles and unit — a unit of "sec" means the',
			'"weight" field is really seconds, and bodyweight exercises log no load.',
			'',
			'nutrition.days[].entries[]: { slot, name, grams, qty, kcal, protein, carbs,',
			`fat } — already totals per entry, not per 100 g. Last ${NUTRITION_DAYS} days only.`,
			'',
			'Absent data means not recorded, not zero. This file has no photos or',
			'personal identifiers beyond what is listed; see counts for what exists.'
		].join('\n'),
		generatedAt: new Date(s.now).toISOString(),
		today,
		weekStartMonday: mondayOf(today),
		timezone: s.timezone || 'unset (server default)',
		profile: s.profile,
		exercises: s.exercises,
		workouts: s.workouts,
		bodyWeights: s.bodyWeights,
		steps: s.steps,
		notes: s.notes,
		goals: s.goals,
		nutrition: { targets: s.profile?.targets ?? null, days: nutritionDays },
		counts
	};
}
