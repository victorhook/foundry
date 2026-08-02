// Model Context Protocol server — the tool surface an MCP client (ChatGPT,
// Claude, an editor) sees when it connects to /mcp. Read-only: every tool here
// is a query, matching the API_TOKEN contract in docs/api.md.
//
// Pure — the data getters arrive as `McpSources` rather than being imported, so
// the protocol and the date arithmetic are unit-testable without opening SQLite
// (same split as ./snapshot vs ./snapshot-write). The route at src/routes/mcp
// supplies the real ones from ./db.

import { enrichWorkout, localDay } from './snapshot';
import type { ProgramDocument } from './documents';

export const SERVER_NAME = 'foundry';
export const SERVER_VERSION = '1.0.0';

/**
 * Protocol revisions we answer to, newest first. `2026-07-28` is the "modern"
 * era (per-request `_meta`, `server/discover`); everything older is "legacy"
 * (an `initialize` handshake). We're dual-era: ChatGPT and most clients still
 * open with `initialize`, but a modern client must not be turned away.
 */
export const SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];

/** What we tell a legacy client when it asks for a revision we don't know. */
const FALLBACK_LEGACY_VERSION = '2025-06-18';

const META_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

/** JSON-RPC + MCP error codes we emit. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

const INSTRUCTIONS = `Foundry is a single person's workout tracker: gym sessions (exercises, sets,
reps, weight), cardio, how each session felt (effort/energy), body pain logs,
body weight, daily step counts, food diary, notes and goals — plus the training
programs, rehab plans and event documents they've uploaded.

Start with get_overview to learn what data exists and over what date range,
then reach for the specific tool. Dates are YYYY-MM-DD in the owner's local
timezone; from/to filters are inclusive. Everything is read-only — you cannot
log or change anything here.`;

/** The database reads a tool may perform. Supplied by the route. */
export type McpSources = {
	now: () => number;
	timezone?: string;
	exercises: () => any[];
	workouts: () => any[];
	painNotes: () => any[];
	notes: () => any[];
	goals: () => any[];
	profile: () => any;
	bodyWeights: () => Array<{ id: number; at: number; weight: number }>;
	steps: () => Array<{ day: string; steps: number }>;
	foodLog: (day: string) => any[];
	templates: () => any[];
	programs: () => any[];
	/**
	 * The document attached to a program, turned into text or an image. Optional:
	 * without it the program tools still report the metadata and say the file
	 * itself is unreadable, which is what the unit tests exercise.
	 */
	programDocument?: (filename: string, mime: string | null) => Promise<ProgramDocument | null>;
	/**
	 * The AI chat agent's cross-chat memory. `memory` reads the current doc;
	 * `saveMemory` replaces it. Optional so the read-only automation surface (and
	 * the unit-test sources) can omit them — the memory tools then report that
	 * saving isn't available here rather than throwing at the transport.
	 */
	memory?: () => string;
	saveMemory?: (content: string) => void;
};

/** An MCP content block a tool wants returned alongside its JSON. */
type ContentBlock = Record<string, unknown>;

/**
 * What a tool returns when JSON isn't the whole answer — `get_program` hands
 * back an image block so the model can actually look at a photographed plan.
 * `data` still goes out as the structured result; `content` rides alongside it,
 * and stays out of the JSON so a megabyte of base64 isn't sent twice.
 */
export class ToolOutput {
	constructor(
		readonly data: Record<string, unknown>,
		readonly content: ContentBlock[]
	) {}
}

type ToolResult = Record<string, unknown> | ToolOutput;

type Tool = {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	run: (args: Record<string, any>, s: McpSources) => ToolResult | Promise<ToolResult>;
};

/* ------------------------------------------------------------------ helpers */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Nothing here needs more than a few hundred rows, and the model pays per row. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Food diary days per call. A year of detail would swamp the context window. */
const MAX_NUTRITION_DAYS = 180;

function optDay(v: unknown, field: string): string | null {
	if (v === undefined || v === null || v === '') { return null; }
	const s = String(v);
	if (!DAY_RE.test(s)) { throw new ToolError(`${field} must be YYYY-MM-DD, got "${s}"`); }
	return s;
}

function limitOf(v: unknown, fallback = DEFAULT_LIMIT): number {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) { return fallback; }
	return Math.min(Math.floor(n), MAX_LIMIT);
}

/** Inclusive YYYY-MM-DD range check — lexicographic order is chronological. */
function inRange(day: string, from: string | null, to: string | null): boolean {
	if (from && day < from) { return false; }
	if (to && day > to) { return false; }
	return true;
}

/** Every calendar day from `from` to `to`, inclusive. */
function daysBetween(from: string, to: string): string[] {
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(`${to}T00:00:00Z`);
	const out: string[] = [];
	for (let t = start; t <= end; t += 86_400_000) {
		out.push(new Date(t).toISOString().slice(0, 10));
	}
	return out;
}

/** `day` shifted back `n` days. */
function minusDays(day: string, n: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

function round(n: number, places = 1): number {
	const f = 10 ** places;
	return Math.round(n * f) / f;
}

/** A tool failed on its input or lookup — reported to the model, not the transport. */
export class ToolError extends Error {}

function exerciseIndex(s: McpSources) {
	return new Map(s.exercises().map((e: any) => [e.id, e]));
}

/** Workouts, enriched and newest first. */
function enrichedWorkouts(s: McpSources) {
	const exById = exerciseIndex(s);
	return s
		.workouts()
		.map((w: any) => enrichWorkout(w, exById, s.timezone))
		.sort((a, b) => b.startedAt - a.startedAt);
}

/** Today, in the owner's zone. */
function today(s: McpSources): string {
	return localDay(s.now(), s.timezone);
}

/* -------------------------------------------------------------------- tools */

const getOverview: Tool = {
	name: 'get_overview',
	title: 'Overview',
	description:
		'What data exists and over what period: workout counts and date range, recent activity, latest body weight, step and nutrition coverage, how many programs are on file, and the owner\'s profile and macro targets. Call this first — it tells you which other tools are worth calling.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	run: (_args, s) => {
		const now = today(s);
		const workouts = enrichedWorkouts(s);
		const days = workouts.map((w) => w.day);
		const since = (n: number) => {
			const cut = minusDays(now, n - 1);
			return workouts.filter((w) => w.day >= cut).length;
		};
		const weights = s.bodyWeights();
		const latestWeight = weights.length ? weights[weights.length - 1] : null;
		const steps = s.steps();
		const recentSteps = steps.filter((d) => d.day >= minusDays(now, 6));
		const profile = s.profile();

		return {
			today: now,
			timezone: s.timezone ?? null,
			workouts: {
				total: workouts.length,
				firstDay: days.length ? days[days.length - 1] : null,
				lastDay: days.length ? days[0] : null,
				last7Days: since(7),
				last28Days: since(28),
				themes: [...new Set(workouts.map((w) => w.theme).filter(Boolean))]
			},
			exerciseCount: s.exercises().length,
			bodyWeight: {
				count: weights.length,
				latest: latestWeight
					? { day: localDay(latestWeight.at, s.timezone), weight: latestWeight.weight }
					: null
			},
			steps: {
				daysRecorded: steps.length,
				last7DayAverage: recentSteps.length
					? Math.round(recentSteps.reduce((a, d) => a + d.steps, 0) / recentSteps.length)
					: null
			},
			painNoteCount: s.painNotes().length,
			noteCount: s.notes().length,
			goalCount: s.goals().length,
			// Uploaded plans are easy to forget exist — a count here is what makes the
			// model reach for list_programs instead of assuming there's no program.
			programCount: s.programs().length,
			profile: { dob: profile?.dob ?? null, height: profile?.height ?? null, gender: profile?.gender ?? null },
			macroTargets: profile?.targets ?? null
		};
	}
};

const listWorkouts: Tool = {
	name: 'list_workouts',
	title: 'List workouts',
	description:
		'Workout sessions, newest first, as summaries: date, theme, how it felt, total volume/duration/distance, the exercises performed and any pain logged. Filter by date range, theme, or an exercise name. Use get_workout for one session\'s full set-by-set detail.',
	inputSchema: {
		type: 'object',
		properties: {
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive).' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive).' },
			theme: { type: 'string', description: 'Only workouts with this theme (case-insensitive).' },
			exercise: { type: 'string', description: 'Only workouts containing an exercise whose name contains this text.' },
			limit: { type: 'integer', description: `Max sessions to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const from = optDay(args.from, 'from');
		const to = optDay(args.to, 'to');
		const theme = args.theme ? String(args.theme).toLowerCase() : null;
		const exercise = args.exercise ? String(args.exercise).toLowerCase() : null;
		const limit = limitOf(args.limit);

		const matched = enrichedWorkouts(s).filter((w) => {
			if (!inRange(w.day, from, to)) { return false; }
			if (theme && (w.theme || '').toLowerCase() !== theme) { return false; }
			if (exercise && !w.exercises.some((e: any) => e.name.toLowerCase().includes(exercise))) { return false; }
			return true;
		});

		return {
			totalMatched: matched.length,
			returned: Math.min(matched.length, limit),
			workouts: matched.slice(0, limit).map((w) => ({
				id: w.id,
				day: w.day,
				weekday: w.weekday,
				time: w.time,
				weekStartMonday: w.weekStartMonday,
				routineName: w.routineName,
				theme: w.theme,
				feel: w.feel,
				energy: w.energy,
				volumeKg: w.volumeKg,
				durationMin: w.durationMin,
				distanceKm: w.distanceKm,
				exercises: w.exercises.map((e: any) => e.name),
				pains: w.pains,
				notes: w.notes
			}))
		};
	}
};

const getWorkout: Tool = {
	name: 'get_workout',
	title: 'Get one workout',
	description:
		'One session in full: every exercise with its individual sets (reps and weight, or duration/distance for cardio), per-exercise notes and pain, plus session totals.',
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'string', description: 'Workout id, as returned by list_workouts.' } },
		required: ['id'],
		additionalProperties: false
	},
	run: (args, s) => {
		const id = String(args.id ?? '');
		if (!id) { throw new ToolError('id is required'); }
		const w = enrichedWorkouts(s).find((x) => x.id === id);
		if (!w) { throw new ToolError(`No workout with id "${id}". Use list_workouts to find valid ids.`); }
		return { workout: w };
	}
};

const searchExercises: Tool = {
	name: 'search_exercises',
	title: 'Search the exercise library',
	description:
		'The exercise library with usage stats: name, type (strength/cardio), muscles worked, unit, and how many times and how recently it was performed. Filter by name or muscle group.',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'Match exercise names containing this text.' },
			muscle: { type: 'string', description: 'Only exercises working this muscle group.' },
			limit: { type: 'integer', description: `Max exercises to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const query = args.query ? String(args.query).toLowerCase() : null;
		const muscle = args.muscle ? String(args.muscle).toLowerCase() : null;
		const limit = limitOf(args.limit);

		const stats = new Map<string, { count: number; lastDay: string | null }>();
		for (const w of enrichedWorkouts(s)) {
			for (const e of w.exercises) {
				const cur = stats.get(e.name) || { count: 0, lastDay: null };
				cur.count++;
				// Workouts arrive newest first, so the first sighting is the latest.
				if (!cur.lastDay) { cur.lastDay = w.day; }
				stats.set(e.name, cur);
			}
		}

		const matched = s.exercises().filter((e: any) => {
			if (query && !String(e.name).toLowerCase().includes(query)) { return false; }
			if (muscle && !(e.muscles || []).some((m: string) => m.toLowerCase().includes(muscle))) { return false; }
			return true;
		});

		return {
			totalMatched: matched.length,
			returned: Math.min(matched.length, limit),
			exercises: matched.slice(0, limit).map((e: any) => ({
				id: e.id,
				name: e.name,
				type: e.type,
				muscles: e.muscles,
				unit: e.unit,
				bodyweight: e.bodyweight,
				// Versions this movement can be logged as; picked per session.
				equipment: e.equipment,
				unilateral: e.unilateral,
				timesPerformed: stats.get(e.name)?.count ?? 0,
				lastPerformed: stats.get(e.name)?.lastDay ?? null
			}))
		};
	}
};

const getExerciseHistory: Tool = {
	name: 'get_exercise_history',
	title: 'Exercise history',
	description:
		'Every session containing one exercise, newest first, with that session\'s sets and volume — the tool for progression questions ("is my bench going up?"). Also returns the heaviest set and best session volume on record.',
	inputSchema: {
		type: 'object',
		properties: {
			exercise: { type: 'string', description: 'Exercise name (or part of one) or exercise id.' },
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive).' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive).' },
			limit: { type: 'integer', description: `Max sessions to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` }
		},
		required: ['exercise'],
		additionalProperties: false
	},
	run: (args, s) => {
		const wanted = String(args.exercise ?? '').trim();
		if (!wanted) { throw new ToolError('exercise is required'); }
		const from = optDay(args.from, 'from');
		const to = optDay(args.to, 'to');
		const limit = limitOf(args.limit);
		const needle = wanted.toLowerCase();

		const all = s.exercises();
		// Prefer an id or exact-name hit; fall back to a substring search, and say so
		// when that is ambiguous rather than silently picking one.
		let target = all.find((e: any) => e.id === wanted || String(e.name).toLowerCase() === needle);
		if (!target) {
			const partial = all.filter((e: any) => String(e.name).toLowerCase().includes(needle));
			if (partial.length === 0) {
				throw new ToolError(`No exercise matching "${wanted}". Use search_exercises to see the library.`);
			}
			if (partial.length > 1) {
				throw new ToolError(
					`"${wanted}" matches ${partial.length} exercises: ${partial.map((e: any) => e.name).join(', ')}. Pass a more specific name.`
				);
			}
			target = partial[0];
		}

		const sessions: any[] = [];
		for (const w of enrichedWorkouts(s)) {
			if (!inRange(w.day, from, to)) { continue; }
			for (const e of w.exercises) {
				if (e.name !== target.name) { continue; }
				sessions.push({
					workoutId: w.id,
					day: w.day,
					weekday: w.weekday,
					theme: w.theme,
					// Which version of the movement — loads only compare within one.
					equipment: e.equipment,
					perSide: e.perSide,
					sets: e.sets,
					setCount: e.setCount,
					volumeKg: e.volumeKg,
					note: e.note,
					pain: e.pain
				});
			}
		}

		let heaviestSet: any = null;
		let bestVolumeKg: { day: string; volumeKg: number } | null = null;
		for (const sess of sessions) {
			for (const set of sess.sets || []) {
				if (typeof set?.weight === 'number' && (!heaviestSet || set.weight > heaviestSet.weight)) {
					heaviestSet = {
						day: sess.day,
						reps: set.reps ?? null,
						weight: set.weight,
						equipment: sess.equipment,
						perSide: sess.perSide
					};
				}
			}
			if (typeof sess.volumeKg === 'number' && (!bestVolumeKg || sess.volumeKg > bestVolumeKg.volumeKg)) {
				bestVolumeKg = { day: sess.day, volumeKg: sess.volumeKg };
			}
		}

		return {
			exercise: {
				id: target.id,
				name: target.name,
				type: target.type,
				unit: target.unit,
				bodyweight: target.bodyweight,
				muscles: target.muscles,
				equipment: target.equipment,
				unilateral: target.unilateral
			},
			totalSessions: sessions.length,
			returned: Math.min(sessions.length, limit),
			heaviestSet,
			bestVolumeKg,
			sessions: sessions.slice(0, limit)
		};
	}
};

const getPain: Tool = {
	name: 'get_pain',
	title: 'Pain log',
	description:
		'Everything logged about pain, newest first, from all three places it is recorded: standalone pain notes, whole-session pain attached to a workout, and pain attached to a specific exercise. Levels run 0 (none) to 10.',
	inputSchema: {
		type: 'object',
		properties: {
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive).' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive).' },
			category: { type: 'string', description: 'Only this body part / pain category (case-insensitive).' },
			limit: { type: 'integer', description: `Max entries to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const from = optDay(args.from, 'from');
		const to = optDay(args.to, 'to');
		const category = args.category ? String(args.category).toLowerCase() : null;
		const limit = limitOf(args.limit);
		const keep = (items: Array<{ cat: string; level: number }>) =>
			category ? items.filter((i) => i.cat.toLowerCase() === category) : items;

		const entries: any[] = [];
		for (const n of s.painNotes()) {
			const items = keep(n.items || []);
			if (!items.length) { continue; }
			entries.push({ source: 'pain_note', at: n.at, day: localDay(n.at, s.timezone), note: n.note || '', items });
		}
		for (const w of enrichedWorkouts(s)) {
			const sessionItems = keep(w.pains || []);
			if (sessionItems.length) {
				entries.push({ source: 'workout', at: w.startedAt, day: w.day, workoutId: w.id, theme: w.theme, items: sessionItems });
			}
			for (const e of w.exercises) {
				if (!e.pain) { continue; }
				const items = keep([e.pain]);
				if (!items.length) { continue; }
				entries.push({ source: 'exercise', at: w.startedAt, day: w.day, workoutId: w.id, exercise: e.name, items });
			}
		}

		const matched = entries.filter((e) => inRange(e.day, from, to)).sort((a, b) => b.at - a.at);
		return {
			totalMatched: matched.length,
			returned: Math.min(matched.length, limit),
			entries: matched.slice(0, limit)
		};
	}
};

const getNutrition: Tool = {
	name: 'get_nutrition',
	title: 'Nutrition',
	description:
		'Food diary totals per day (calories, protein, carbs, fat) over a date range, with averages and the owner\'s macro targets for comparison. Set detail=true to also get every logged item per day. Days with nothing logged are omitted.',
	inputSchema: {
		type: 'object',
		properties: {
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive). Defaults to 13 days before `to`.' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive). Defaults to today.' },
			detail: { type: 'boolean', description: 'Include the individual food entries for each day.' }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const to = optDay(args.to, 'to') ?? today(s);
		const from = optDay(args.from, 'from') ?? minusDays(to, 13);
		if (from > to) { throw new ToolError(`from (${from}) is after to (${to})`); }
		const span = daysBetween(from, to);
		if (span.length > MAX_NUTRITION_DAYS) {
			throw new ToolError(
				`Range is ${span.length} days; ${MAX_NUTRITION_DAYS} is the maximum per call. Narrow it or ask for several ranges.`
			);
		}
		const detail = args.detail === true;

		const days: any[] = [];
		for (const day of span) {
			const log = s.foodLog(day);
			if (!log.length) { continue; }
			const sum = (k: string) => round(log.reduce((a: number, e: any) => a + (Number(e[k]) || 0), 0));
			days.push({
				day,
				entryCount: log.length,
				kcal: sum('kcal'),
				protein: sum('protein'),
				carbs: sum('carbs'),
				fat: sum('fat'),
				...(detail
					? { entries: log.map((e: any) => ({ slot: e.slot, name: e.name, grams: e.grams, qty: e.qty, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat })) }
					: {})
			});
		}

		const avg = (k: string) =>
			days.length ? round(days.reduce((a, d) => a + d[k], 0) / days.length) : null;

		return {
			from,
			to,
			daysLogged: days.length,
			daysInRange: span.length,
			averages: { kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') },
			targets: s.profile()?.targets ?? null,
			days
		};
	}
};

const getBodyWeight: Tool = {
	name: 'get_body_weight',
	title: 'Body weight',
	description: 'Body weight measurements over a date range, oldest first, with the net change across the range.',
	inputSchema: {
		type: 'object',
		properties: {
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive).' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive).' }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const from = optDay(args.from, 'from');
		const to = optDay(args.to, 'to');
		const entries = s
			.bodyWeights()
			.map((w) => ({ day: localDay(w.at, s.timezone), at: w.at, weight: w.weight }))
			.filter((w) => inRange(w.day, from, to));
		const first = entries[0] ?? null;
		const last = entries.length ? entries[entries.length - 1] : null;
		return {
			count: entries.length,
			first,
			last,
			changeKg: first && last ? round(last.weight - first.weight, 2) : null,
			entries
		};
	}
};

const getSteps: Tool = {
	name: 'get_steps',
	title: 'Daily steps',
	description: 'Daily step counts (synced from Google Fit) over a date range, oldest first, with the total and daily average.',
	inputSchema: {
		type: 'object',
		properties: {
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive). Defaults to 29 days before `to`.' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive). Defaults to today.' }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const to = optDay(args.to, 'to') ?? today(s);
		const from = optDay(args.from, 'from') ?? minusDays(to, 29);
		const days = s.steps().filter((d) => inRange(d.day, from, to));
		const total = days.reduce((a, d) => a + d.steps, 0);
		return {
			from,
			to,
			daysRecorded: days.length,
			total,
			dailyAverage: days.length ? Math.round(total / days.length) : null,
			days
		};
	}
};

const getNotes: Tool = {
	name: 'get_notes',
	title: 'Notes',
	description: 'Free-text notes the owner attached to particular days, newest first. Optionally filter by date range or search their text.',
	inputSchema: {
		type: 'object',
		properties: {
			from: { type: 'string', description: 'Earliest day, YYYY-MM-DD (inclusive).' },
			to: { type: 'string', description: 'Latest day, YYYY-MM-DD (inclusive).' },
			query: { type: 'string', description: 'Only notes whose text contains this (case-insensitive).' },
			limit: { type: 'integer', description: `Max notes to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const from = optDay(args.from, 'from');
		const to = optDay(args.to, 'to');
		const query = args.query ? String(args.query).toLowerCase() : null;
		const limit = limitOf(args.limit);
		const matched = s.notes().filter((n: any) => {
			if (!inRange(n.day, from, to)) { return false; }
			if (query && !String(n.text || '').toLowerCase().includes(query)) { return false; }
			return true;
		});
		return {
			totalMatched: matched.length,
			returned: Math.min(matched.length, limit),
			notes: matched.slice(0, limit).map((n: any) => ({ id: n.id, day: n.day, text: n.text }))
		};
	}
};

const getGoals: Tool = {
	name: 'get_goals',
	title: 'Goals',
	description: 'The owner\'s training goals, in their chosen order, with target values and whether each is marked done.',
	inputSchema: {
		type: 'object',
		properties: {
			includeDone: { type: 'boolean', description: 'Include goals already marked done (default true).' }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const includeDone = args.includeDone !== false;
		const goals = s
			.goals()
			.filter((g: any) => includeDone || !g.done)
			.map((g: any) => ({ id: g.id, kind: g.kind, title: g.title, target: g.target, filter: g.filter, done: g.done }));
		return { count: goals.length, goals };
	}
};

const listTemplates: Tool = {
	name: 'list_templates',
	title: 'Workout templates',
	description: 'The owner\'s saved workout templates (planned routines) with the exercises, set counts and target reps/weight in each.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	run: (_args, s) => {
		const exById = exerciseIndex(s);
		const templates = s.templates().map((t: any) => ({
			id: t.id,
			name: t.name,
			entries: (t.entries || []).map((e: any) => ({
				exercise: exById.get(e.exerciseId)?.name ?? e.exerciseId,
				setCount: e.setCount,
				reps: e.reps,
				weight: e.weight
			}))
		}));
		return { count: templates.length, templates };
	}
};

/** The kinds a program row can have, as the app's own editor writes them. */
const PROGRAM_KINDS = ['program', 'rehab', 'event'];

/** How a program's attachment will come back, without reading the file. */
function documentKind(mime: string | null): 'pdf' | 'image' | 'other' | null {
	if (!mime) { return null; }
	if (mime === 'application/pdf') { return 'pdf'; }
	return mime.startsWith('image/') ? 'image' : 'other';
}

function programSummary(p: any) {
	return {
		id: p.id,
		title: p.title,
		kind: p.kind || 'program',
		startDate: p.startDate ?? null,
		notes: p.notes || '',
		document: p.filename
			? { attached: true, type: documentKind(p.mime ?? null), mime: p.mime ?? null }
			: { attached: false, type: null, mime: null }
	};
}

const listPrograms: Tool = {
	name: 'list_programs',
	title: 'Programs, rehab plans and events',
	description:
		'Training programs, rehab protocols and events the owner has saved — title, kind, start date, their own notes, and whether a document is attached. Most of these are a PDF or a picture from a coach or physio; call get_program to actually read one.',
	inputSchema: {
		type: 'object',
		properties: {
			kind: { type: 'string', enum: PROGRAM_KINDS, description: 'Only this kind of entry.' },
			query: { type: 'string', description: 'Only entries whose title or notes contain this text.' }
		},
		additionalProperties: false
	},
	run: (args, s) => {
		const kind = args.kind ? String(args.kind).toLowerCase() : null;
		if (kind && !PROGRAM_KINDS.includes(kind)) {
			throw new ToolError(`kind must be one of ${PROGRAM_KINDS.join(', ')}, got "${args.kind}"`);
		}
		const query = args.query ? String(args.query).toLowerCase() : null;
		const programs = s
			.programs()
			.map(programSummary)
			.filter((p) => {
				if (kind && p.kind !== kind) { return false; }
				if (query && !`${p.title} ${p.notes}`.toLowerCase().includes(query)) { return false; }
				return true;
			});
		return { count: programs.length, programs };
	}
};

const getProgram: Tool = {
	name: 'get_program',
	title: 'Read a program document',
	description:
		'One program, rehab plan or event with its attached document read out: a PDF comes back as text page by page, an image comes back as a picture you can look at. Use it to answer questions about what a plan actually prescribes, or to compare logged workouts against it. A scanned PDF with no text layer can\'t be read — you\'ll be told so.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', description: 'Program id, as returned by list_programs.' },
			document: {
				type: 'boolean',
				description: 'Read the attached document (default true). Set false for just the metadata.'
			}
		},
		required: ['id'],
		additionalProperties: false
	},
	run: async (args, s) => {
		const id = String(args.id ?? '');
		if (!id) { throw new ToolError('id is required'); }
		const row = s.programs().find((p: any) => p.id === id);
		if (!row) { throw new ToolError(`No program with id "${id}". Use list_programs to find valid ids.`); }

		const program = programSummary(row);
		if (args.document === false || !row.filename) {
			return { program };
		}
		if (!s.programDocument) {
			return { program, document: { type: 'unavailable', reason: 'Documents cannot be read on this server.' } };
		}

		const doc = await s.programDocument(String(row.filename), row.mime ?? null);
		if (!doc) {
			return { program, document: { type: 'unavailable', reason: 'The attached file could not be read.' } };
		}
		if (doc.type === 'text') {
			return {
				program,
				document: {
					type: 'text',
					mime: doc.mime,
					pages: doc.pages,
					truncated: doc.truncated,
					text: doc.text
				}
			};
		}
		if (doc.type === 'image') {
			// The picture goes back as an image block, not as base64 in the JSON —
			// that's the difference between the model seeing the plan and being told
			// a file exists.
			return new ToolOutput(
				{ program, document: { type: 'image', mime: doc.mime, bytes: doc.bytes, note: 'The image follows this JSON.' } },
				[{ type: 'image', data: doc.base64, mimeType: doc.mime }]
			);
		}
		return { program, document: { type: 'unavailable', mime: doc.mime, reason: doc.reason } };
	}
};

const getMemory: Tool = {
	name: 'get_memory',
	title: 'Read memory',
	description:
		'Read your durable cross-chat memory about the owner — what you have chosen to remember across conversations (injuries and limitations, how they like you to respond, standing goals, equipment, schedule). It is also given to you at the start of each chat, so you rarely need to call this; use it to double-check the exact current text before rewriting it with save_memory.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	run: (_args, s) => {
		return { content: s.memory ? s.memory() : '' };
	}
};

const saveMemory: Tool = {
	name: 'save_memory',
	title: 'Save memory',
	description:
		'Replace your durable cross-chat memory about the owner with `content`. Pass the FULL updated doc (it overwrites, it does not append): keep it concise, deduplicated, and current — merge new facts in and drop anything obsolete. Save only durable, useful things (an injury or limitation, a lasting preference for how you respond, a standing goal, their equipment or schedule) — not one-off calculations, transient questions, or anything they would not want you to bring up in a future chat. Pass an empty string to forget everything.',
	inputSchema: {
		type: 'object',
		properties: {
			content: { type: 'string', description: 'The full memory doc to store (markdown). Overwrites the previous one.' }
		},
		required: ['content'],
		additionalProperties: false
	},
	run: (args, s) => {
		if (!s.saveMemory) {
			throw new ToolError('Saving memory is not available on this connection.');
		}
		const content = String(args.content ?? '');
		if (content.length > 20000) {
			throw new ToolError('Memory is too long (max 20000 characters) — keep it concise.');
		}
		s.saveMemory(content);
		return { ok: true, savedChars: content.length };
	}
};

export const TOOLS: Tool[] = [
	getOverview,
	listWorkouts,
	getWorkout,
	searchExercises,
	getExerciseHistory,
	getPain,
	getNutrition,
	getBodyWeight,
	getSteps,
	getNotes,
	getGoals,
	listTemplates,
	listPrograms,
	getProgram,
	getMemory,
	saveMemory
];

/* ----------------------------------------------------------------- protocol */

export type JsonRpcRequest = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, any>;
};

export type JsonRpcResponse = {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

const CAPABILITIES = { tools: { listChanged: false } };
const SERVER_INFO = { name: SERVER_NAME, title: 'Foundry', version: SERVER_VERSION };

/** Run a tool and shape the result the way `tools/call` wants it. */
async function callTool(name: string, args: Record<string, any>, sources: McpSources) {
	const tool = TOOLS.find((t) => t.name === name);
	if (!tool) {
		return {
			content: [{ type: 'text', text: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}.` }],
			isError: true
		};
	}
	try {
		const out = await tool.run(args ?? {}, sources);
		const data = out instanceof ToolOutput ? out.data : out;
		const extra = out instanceof ToolOutput ? out.content : [];
		// Both shapes on purpose: `structuredContent` for clients that parse it,
		// the JSON text block for those that only read content.
		return {
			content: [{ type: 'text', text: JSON.stringify(data, null, 2) }, ...extra],
			structuredContent: data
		};
	} catch (e) {
		// A bad argument or a missing record is the model's problem to fix, so it
		// comes back as a tool error it can read — not a transport-level failure.
		const message = e instanceof ToolError ? e.message : `Tool "${name}" failed: ${(e as Error).message}`;
		return { content: [{ type: 'text', text: message }], isError: true };
	}
}

/**
 * Handle one JSON-RPC message. Returns the response, or null for a notification
 * (which by definition gets no reply). Async only because reading a program
 * document is — everything else answers from memory.
 */
export async function handleRpc(msg: JsonRpcRequest, sources: McpSources): Promise<JsonRpcResponse | null> {
	if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
		return fail(null, INVALID_REQUEST, 'Invalid JSON-RPC request');
	}
	const { method } = msg;
	const params = msg.params ?? {};
	// A notification has no id and expects no response.
	const isNotification = msg.id === undefined || msg.id === null;
	const id = msg.id ?? null;

	if (method.startsWith('notifications/')) { return null; }

	// Modern clients declare their revision on every request; reject unsupported
	// ones so the client can retry with something we speak. Legacy clients send
	// no `_meta` and negotiate through `initialize` instead.
	const declared = params?._meta?.[META_VERSION_KEY];
	if (typeof declared === 'string' && !SUPPORTED_VERSIONS.includes(declared)) {
		return fail(id, UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
			supported: SUPPORTED_VERSIONS,
			requested: declared
		});
	}

	switch (method) {
		// Modern (2026-07-28) discovery.
		case 'server/discover':
			return ok(id, {
				resultType: 'complete',
				supportedVersions: SUPPORTED_VERSIONS,
				capabilities: CAPABILITIES,
				instructions: INSTRUCTIONS,
				_meta: { [META_SERVER_INFO_KEY]: SERVER_INFO }
			});

		// Legacy (2025-11-25 and earlier) handshake. Echo the client's revision
		// when we know it, otherwise name one we do support.
		case 'initialize': {
			const asked = String(params.protocolVersion ?? '');
			return ok(id, {
				protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : FALLBACK_LEGACY_VERSION,
				capabilities: CAPABILITIES,
				serverInfo: SERVER_INFO,
				instructions: INSTRUCTIONS
			});
		}

		case 'ping':
			return ok(id, {});

		case 'tools/list':
			return ok(id, {
				tools: TOOLS.map((t) => ({
					name: t.name,
					title: t.title,
					description: t.description,
					inputSchema: t.inputSchema,
					annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
				}))
			});

		case 'tools/call': {
			const name = String(params.name ?? '');
			if (!name) { return fail(id, INVALID_PARAMS, 'tools/call requires a tool name'); }
			return ok(id, await callTool(name, params.arguments ?? {}, sources));
		}

		default:
			if (isNotification) { return null; }
			return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
	}
}

/**
 * Handle a parsed request body — a single message, or a batch (JSON-RPC 2.0
 * batching, used by protocol revision 2025-03-26). Returns null when nothing
 * needs a reply, which the transport turns into `202 Accepted`.
 */
export async function handleMessage(
	body: unknown,
	sources: McpSources
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
	if (Array.isArray(body)) {
		if (body.length === 0) { return fail(null, INVALID_REQUEST, 'Empty batch'); }
		const settled = await Promise.all(body.map((m) => handleRpc(m as JsonRpcRequest, sources)));
		const responses = settled.filter((r): r is JsonRpcResponse => r !== null);
		return responses.length ? responses : null;
	}
	return handleRpc(body as JsonRpcRequest, sources);
}

export const RPC_ERRORS = { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, UNSUPPORTED_PROTOCOL_VERSION };
