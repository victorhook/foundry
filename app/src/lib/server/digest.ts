// A ranged digest of everything logged — workouts, pain, steps, weight,
// nutrition, notes, goals — in one small text file meant to be handed to an AI
// agent (pasted into a chat, or dropped in a workspace).
//
// The format is sectioned TSV with a self-describing header rather than JSON:
// same information at a fraction of the tokens (no repeated keys), and still
// strict — fixed column order per section, '-' for "not recorded", declared
// escaping. A caller that wants objects asks for JSON instead; both come from
// the same filtered data below.
//
// Pure — no database, no filesystem — so the shape and the date arithmetic are
// unit-testable without opening SQLite. The reader lives in ./digest-read.

import { enrichWorkout, localDay, localTime, localWeekday } from './snapshot';

export const DIGEST_VERSION = 'v1';

/** Inclusive YYYY-MM-DD bounds. */
export type DigestRange = { from: string; to: string };

export type DigestSources = {
	now: number;
	timezone?: string;
	range: DigestRange;
	exercises: any[];
	workouts: any[];
	bodyWeights: any[];
	steps: any[];
	notes: any[];
	painNotes: any[];
	goals: any[];
	programs?: any[];
	profile?: any;
	/** Food-diary entries keyed YYYY-MM-DD; only days in range need to be present. */
	foodLog?: Record<string, any[]>;
};

/** `n` whole days back from `today`, inclusive of today (7 → a week ending now). */
export function rangeOfDays(today: string, days: number): DigestRange {
	const [y, m, d] = today.split('-').map(Number);
	const end = Date.UTC(y, m - 1, d);
	const n = Math.max(1, Math.floor(days));
	return { from: new Date(end - (n - 1) * 86400000).toISOString().slice(0, 10), to: today };
}

const inRange = (day: string, r: DigestRange) => day >= r.from && day <= r.to;

/** Days between the bounds, inclusive. */
export function rangeDays(r: DigestRange): number {
	const ms = Date.parse(r.to + 'T00:00:00Z') - Date.parse(r.from + 'T00:00:00Z');
	return Math.round(ms / 86400000) + 1;
}

// Free text shares a line with tab-separated columns, so tabs and newlines are
// flattened rather than escaped — a digest is for reading, not round-tripping.
function cell(v: unknown): string {
	if (v === null || v === undefined || v === '') { return '-'; }
	if (typeof v === 'number') { return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10); }
	const s = String(v).replace(/[\t\r\n]+/g, ' ').trim();
	return s === '' ? '-' : s;
}
const row = (...cells: unknown[]) => cells.map(cell).join('\t');
const avg = (ns: number[]) => (ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10 : null);

// "8x50,8x50,6x55" for loaded sets, "12,10,8" when there's no external load,
// "min=45 km=12.4" for cardio. Whatever the unit column says the numbers mean.
function setsCell(ex: any): string {
	const sets = ex.sets || [];
	if (!sets.length) { return '-'; }
	if (ex.type === 'cardio') {
		return sets
			.map((s: any) => {
				const parts = [];
				if (s?.duration != null) { parts.push(`min=${cell(s.duration)}`); }
				if (s?.distance != null) { parts.push(`km=${cell(s.distance)}`); }
				if (s?.pace) { parts.push(`pace=${cell(s.pace)}`); }
				return parts.join(' ') || '-';
			})
			.join(';');
	}
	return sets
		.map((s: any) => (s?.weight == null ? cell(s?.reps) : `${cell(s.reps)}x${cell(s.weight)}`))
		.join(',');
}

function unitCell(ex: any): string {
	if (ex.type === 'cardio') { return 'cardio'; }
	if (ex.bodyweight) { return 'bw'; }
	return ex.unit === 'sec' ? 'sec' : 'kg';
}

const painCell = (items: any[]) =>
	(items || []).map((p: any) => `${cell(p.cat)}:${cell(p.level)}`).join(',') || '-';

/** Everything in the range, already enriched and filtered. Shared by both formats. */
export function digestData(s: DigestSources) {
	const r = s.range;
	const exById = new Map((s.exercises || []).map((e: any) => [e.id, e]));
	const workouts = (s.workouts || [])
		.map((w) => enrichWorkout(w, exById, s.timezone))
		.filter((w) => inRange(w.day, r))
		.sort((a, b) => a.startedAt - b.startedAt);
	const pain = (s.painNotes || [])
		.map((p: any) => ({
			day: localDay(p.at, s.timezone),
			weekday: localWeekday(p.at, s.timezone),
			time: localTime(p.at, s.timezone),
			at: p.at,
			note: p.note || '',
			items: p.items || [],
			worst: (p.items || []).reduce(
				(m: number | null, i: any) => (typeof i?.level === 'number' && (m === null || i.level > m) ? i.level : m),
				null as number | null
			)
		}))
		.filter((p) => inRange(p.day, r))
		.sort((a, b) => a.at - b.at);
	const steps = (s.steps || []).filter((x: any) => inRange(x.day, r)).sort((a: any, b: any) => (a.day < b.day ? -1 : 1));
	const weights = (s.bodyWeights || [])
		.map((w: any) => ({ day: localDay(w.at, s.timezone), at: w.at, weight: w.weight }))
		.filter((w) => inRange(w.day, r))
		.sort((a, b) => a.at - b.at);
	const notes = (s.notes || []).filter((n: any) => inRange(n.day, r)).sort((a: any, b: any) => (a.day < b.day ? -1 : 1));
	const nutrition = Object.entries(s.foodLog || {})
		.filter(([day, entries]) => inRange(day, r) && (entries as any[]).length > 0)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([day, entries]) => {
			const sum = (k: string) => (entries as any[]).reduce((t, e: any) => t + (Number(e[k]) || 0), 0);
			return {
				day,
				kcal: Math.round(sum('kcal')),
				protein: Math.round(sum('protein')),
				carbs: Math.round(sum('carbs')),
				fat: Math.round(sum('fat')),
				entries: (entries as any[]).length
			};
		});

	// Pain is logged in two places — standalone notes and inside a session — and a
	// question about an ache needs both, so the worst-per-area folds them together.
	const worstByArea: Record<string, number> = {};
	const bump = (cat: string, level: number) => {
		if (!cat || typeof level !== 'number') { return; }
		worstByArea[cat] = Math.max(worstByArea[cat] ?? 0, level);
	};
	pain.forEach((p) => (p.items || []).forEach((i: any) => bump(i.cat, i.level)));
	workouts.forEach((w) => {
		(w.pains || []).forEach((i: any) => bump(i.cat, i.level));
		w.exercises.forEach((e: any) => { if (e.pain) { bump(e.pain.cat, e.pain.level); } });
	});

	const setsByExercise: Record<string, number> = {};
	let setsTotal = 0;
	let cardioMin = 0;
	let cardioKm = 0;
	let volumeTotal = 0;
	workouts.forEach((w) => {
		if (w.volumeKg != null) { volumeTotal += w.volumeKg; }
		if (w.durationMin != null) { cardioMin += w.durationMin; }
		if (w.distanceKm != null) { cardioKm += w.distanceKm; }
		w.exercises.forEach((e: any) => {
			setsTotal += e.setCount || 0;
			setsByExercise[e.name] = (setsByExercise[e.name] || 0) + (e.setCount || 0);
		});
	});
	const stepCounts = steps.map((x: any) => x.steps);

	const summary = {
		sessions: workouts.length,
		trainingDays: new Set(workouts.map((w) => w.day)).size,
		volumeKg: volumeTotal || null,
		sets: setsTotal || null,
		cardioMin: cardioMin || null,
		cardioKm: cardioKm ? Math.round(cardioKm * 100) / 100 : null,
		feelAvg: avg(workouts.map((w) => w.feel).filter((v): v is number => typeof v === 'number')),
		energyAvg: avg(workouts.map((w) => w.energy).filter((v): v is number => typeof v === 'number')),
		topExercises:
			Object.entries(setsByExercise)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([name, n]) => `${name}:${n}`)
				.join(', ') || null,
		stepDays: steps.length || null,
		stepsAvg: stepCounts.length ? Math.round(stepCounts.reduce((a: number, b: number) => a + b, 0) / stepCounts.length) : null,
		stepsBest: stepCounts.length ? Math.max(...stepCounts) : null,
		weightFirst: weights.length ? weights[0].weight : null,
		weightLast: weights.length ? weights[weights.length - 1].weight : null,
		weightChange: weights.length > 1 ? Math.round((weights[weights.length - 1].weight - weights[0].weight) * 10) / 10 : null,
		painEntries: pain.length || null,
		painWorst:
			Object.entries(worstByArea)
				.sort((a, b) => b[1] - a[1])
				.map(([cat, lvl]) => `${cat}:${lvl}`)
				.join(', ') || null,
		nutritionDays: nutrition.length || null,
		kcalAvg: avg(nutrition.map((d) => d.kcal)),
		proteinAvg: avg(nutrition.map((d) => d.protein)),
		notes: notes.length || null
	};

	return { range: r, workouts, pain, steps, weights, notes, nutrition, summary };
}

// Three line kinds and nothing else: the magic first line, ';' comments, '#'
// section headers, and tab-separated records. A parser needs no more than that.
const FORMAT_NOTE = [
	'Tab-separated. Every line is one of: this file\'s first line (format + version),',
	'a comment (starts with ";"), a section header (starts with "# ", then the',
	'section name, then a TAB and that section\'s column names), or a record — the',
	'columns named by the header above it, in that order, one per line.',
	'A header with no records under it means nothing was logged for it in this range.',
	'"-" means not recorded. It never means zero.',
	'Free text has tabs and newlines flattened to spaces.',
	'SETS.sets: loaded sets are "reps x load" comma-separated ("8x50,8x50,6x65");',
	'with no external load it is reps only ("12,10,8"); cardio is "min=.. km=..',
	'pace=..". The unit column says what the load is: kg, sec (a timed hold, so the',
	'load field holds seconds), bw (bodyweight, no load) or cardio.',
	'Pain is "area:level" (level 1-10) and is logged in two places — standalone',
	'entries in PAIN, and inside a session on WORKOUTS.pain (whole session) or',
	'SETS.pain (one movement). Check both before concluding anything about an area.',
	'volumeKg is total load moved (reps x weight, summed); it is "-" where kilograms',
	'are meaningless. Days are the owner\'s local calendar days, dates YYYY-MM-DD.',
	'One exercise covers every version of a movement: SETS.equipment and perSide say',
	'which version that session was, and loads only compare within the same version.',
	'NUTRITION is daily totals, not per-item. GOALS and PROGRAMS are current state,',
	'not range-filtered. Absent data means not recorded — there is nothing hidden.'
].map((l) => '; ' + l).join('\n');

/** The digest as text. */
export function buildDigest(s: DigestSources): string {
	const d = digestData(s);
	const out: string[] = [];
	out.push(`FOUNDRY-DIGEST ${DIGEST_VERSION}`);
	out.push(FORMAT_NOTE);

	out.push('');
	out.push('# META\tkey\tvalue');
	out.push(row('from', d.range.from));
	out.push(row('to', d.range.to));
	out.push(row('days', rangeDays(d.range)));
	out.push(row('today', localDay(s.now, s.timezone)));
	out.push(row('timezone', s.timezone || 'unset (server default)'));
	out.push(row('generated', new Date(s.now).toISOString()));
	const p = s.profile || {};
	const t = p.targets || {};
	for (const [k, v] of Object.entries({
		dob: p.dob, heightCm: p.height, gender: p.gender,
		targetKcal: t.kcal, targetProtein: t.protein, targetCarbs: t.carbs, targetFat: t.fat
	})) {
		if (v !== null && v !== undefined && v !== '') { out.push(row(k, v)); }
	}

	out.push('');
	out.push('# SUMMARY\tkey\tvalue');
	for (const [k, v] of Object.entries(d.summary)) {
		if (v !== null && v !== undefined) { out.push(row(k, v)); }
	}

	out.push('');
	out.push('# WORKOUTS\tid\tday\tweekday\ttime\troutine\ttheme\tfeel\tenergy\tvolumeKg\tmin\tkm\tpain\tnotes');
	d.workouts.forEach((w, i) => {
		out.push(
			row(`W${i + 1}`, w.day, w.weekday, w.time, w.routineName, w.theme, w.feel, w.energy,
				w.volumeKg, w.durationMin, w.distanceKm, painCell(w.pains), w.notes)
		);
	});

	out.push('');
	out.push('# SETS\tworkout\texercise\tunit\tequipment\tperSide\tsets\tvolumeKg\tpain\tnote');
	d.workouts.forEach((w, i) => {
		w.exercises.forEach((e: any) => {
			out.push(
				row(`W${i + 1}`, e.name, unitCell(e), e.equipment, e.perSide ? 'yes' : null,
					setsCell(e), e.volumeKg, e.pain ? painCell([e.pain]) : null, e.note)
			);
		});
	});

	out.push('');
	out.push('# PAIN\tday\tweekday\ttime\titems\tworst\tnote');
	d.pain.forEach((p) => out.push(row(p.day, p.weekday, p.time, painCell(p.items), p.worst, p.note)));

	out.push('');
	out.push('# STEPS\tday\tsteps');
	d.steps.forEach((x: any) => out.push(row(x.day, x.steps)));

	out.push('');
	out.push('# WEIGHT\tday\tkg');
	d.weights.forEach((w) => out.push(row(w.day, w.weight)));

	out.push('');
	out.push('# NUTRITION\tday\tkcal\tprotein\tcarbs\tfat\tentries');
	d.nutrition.forEach((n) => out.push(row(n.day, n.kcal, n.protein, n.carbs, n.fat, n.entries)));

	out.push('');
	out.push('# NOTES\tday\ttext');
	d.notes.forEach((n: any) => out.push(row(n.day, n.text)));

	out.push('');
	out.push('# GOALS\tkind\ttitle\ttarget\tdone');
	(s.goals || []).forEach((g: any) => {
		const target = g.kind === 'exercise'
			? [g.targetValue, g.reps ? `x${g.reps}` : null, g.equipment].filter(Boolean).join(' ')
			: g.target;
		out.push(row(g.kind, g.title, target, g.done ? 'yes' : 'no'));
	});

	out.push('');
	out.push('# PROGRAMS\tkind\ttitle\tstartDate\tnotes');
	(s.programs || []).forEach((p: any) => out.push(row(p.kind, p.title, p.startDate, p.notes)));

	return out.join('\n') + '\n';
}
