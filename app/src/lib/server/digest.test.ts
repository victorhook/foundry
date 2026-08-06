import { describe, it, expect } from 'vitest';
import { buildDigest, digestData, rangeOfDays, rangeDays } from './digest';

const TZ = 'Europe/Stockholm';
// 2026-08-04 18:12 local.
const AUG4 = Date.parse('2026-08-04T16:12:00Z');
const AUG2 = Date.parse('2026-08-02T09:00:00Z');
const JUL1 = Date.parse('2026-07-01T09:00:00Z');
const NOW = Date.parse('2026-08-06T10:00:00Z');

const exercises = [
	{ id: 'bench', name: 'Bench Press', type: 'strength', unit: 'kg', bodyweight: false, muscles: ['Chest'] },
	{ id: 'pullup', name: 'Pull-up', type: 'strength', unit: 'kg', bodyweight: true, muscles: ['Back'] },
	{ id: 'plank', name: 'Plank', type: 'strength', unit: 'sec', bodyweight: false, muscles: ['Core'] },
	{ id: 'run', name: 'Run', type: 'cardio', unit: 'kg', bodyweight: false, muscles: ['Cardio'] }
];

const sources = (over: any = {}) => ({
	now: NOW,
	timezone: TZ,
	range: rangeOfDays('2026-08-06', 7),
	exercises,
	workouts: [
		{
			id: 'w1', startedAt: AUG4, routineName: 'Gym', theme: 'Chest', feel: 7, energy: 4,
			notes: 'felt strong', pains: [{ cat: 'Shoulders', level: 3 }],
			entries: [
				{ exerciseId: 'bench', equipment: 'barbell', sets: [{ reps: 8, weight: 50 }, { reps: 8, weight: 50 }] },
				{ exerciseId: 'pullup', sets: [{ reps: 8 }, { reps: 6 }], pain: { cat: 'Elbows', level: 2 } },
				{ exerciseId: 'plank', sets: [{ reps: 1, weight: 60 }] }
			]
		},
		{
			id: 'w2', startedAt: AUG2, routineName: 'Run', theme: null, feel: 5, energy: 3, notes: '',
			pains: [], entries: [{ exerciseId: 'run', sets: [{ duration: 32, distance: 6.2, pace: null }] }]
		},
		// Well outside the window — must not appear anywhere, including the totals.
		{
			id: 'w0', startedAt: JUL1, routineName: 'Gym', theme: null, feel: 9, energy: 9, notes: 'old',
			pains: [], entries: [{ exerciseId: 'bench', sets: [{ reps: 5, weight: 100 }] }]
		}
	],
	bodyWeights: [
		{ id: 1, at: JUL1, weight: 90 },
		{ id: 2, at: AUG2, weight: 82.4 },
		{ id: 3, at: AUG4, weight: 81.2 }
	],
	steps: [
		{ day: '2026-07-01', steps: 3000 },
		{ day: '2026-08-04', steps: 12480 },
		{ day: '2026-08-05', steps: 4820 }
	],
	notes: [
		{ id: 'n1', day: '2026-08-04', text: 'Shoulder\ttwinge\non pressing' },
		{ id: 'n0', day: '2026-07-01', text: 'old note' }
	],
	painNotes: [
		{ id: 'p1', at: AUG2, note: 'stiff morning', items: [{ cat: 'Lower back', level: 6 }, { cat: 'Hips', level: 3 }] },
		{ id: 'p0', at: JUL1, note: 'ancient', items: [{ cat: 'Knees', level: 9 }] }
	],
	goals: [{ kind: 'exercise', title: 'Bench 100', targetValue: 100, reps: 5, equipment: 'barbell', done: false }],
	programs: [{ kind: 'rehab', title: 'Shoulder protocol', startDate: '2026-07-20', notes: '3x/week' }],
	profile: { dob: '1988-04-02', height: 182, gender: 'Male', targets: { kcal: 2400, protein: 180, carbs: null, fat: null } },
	foodLog: {
		'2026-08-04': [
			{ slot: 'breakfast', name: 'Oats', kcal: 400, protein: 14, carbs: 60, fat: 8 },
			{ slot: 'lunch', name: 'Chicken', kcal: 600, protein: 55, carbs: 40, fat: 18 }
		],
		'2026-07-01': [{ slot: 'lunch', name: 'Old', kcal: 999, protein: 1, carbs: 1, fat: 1 }]
	},
	...over
});

// A section's rows, by header name.
function section(text: string, name: string): string[] {
	const lines = text.split('\n');
	const start = lines.findIndex((l) => l.startsWith(`# ${name}\t`));
	expect(start, `section ${name} is present`).toBeGreaterThan(-1);
	const out: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith('#') || lines[i] === '') { break; }
		out.push(lines[i]);
	}
	return out;
}

describe('rangeOfDays', () => {
	it('counts today as one of the days', () => {
		expect(rangeOfDays('2026-08-06', 7)).toEqual({ from: '2026-07-31', to: '2026-08-06' });
		expect(rangeDays(rangeOfDays('2026-08-06', 7))).toBe(7);
	});

	it('crosses a month boundary', () => {
		expect(rangeOfDays('2026-03-02', 5)).toEqual({ from: '2026-02-26', to: '2026-03-02' });
	});
});

// The whole point of a ranged digest is that "last week" means last week — a
// stray older session would silently poison every total in the summary.
describe('digestData range filtering', () => {
	it('keeps only what falls inside the window', () => {
		const d = digestData(sources());
		expect(d.workouts.map((w: any) => w.id)).toEqual(['w2', 'w1']); // oldest first
		expect(d.pain).toHaveLength(1);
		expect(d.steps.map((s: any) => s.day)).toEqual(['2026-08-04', '2026-08-05']);
		expect(d.weights.map((w: any) => w.weight)).toEqual([82.4, 81.2]);
		expect(d.notes.map((n: any) => n.id)).toEqual(['n1']);
		expect(d.nutrition.map((n: any) => n.day)).toEqual(['2026-08-04']);
	});

	it('summarizes only the window', () => {
		const s = digestData(sources()).summary;
		expect(s.sessions).toBe(2);
		expect(s.trainingDays).toBe(2);
		expect(s.volumeKg).toBe(800); // 2x(8x50); the July 100kg single is out
		expect(s.sets).toBe(6);
		expect(s.cardioMin).toBe(32);
		expect(s.cardioKm).toBe(6.2);
		expect(s.feelAvg).toBe(6); // (7+5)/2 — not the 9 from July
		expect(s.weightChange).toBe(-1.2);
		expect(s.stepsAvg).toBe(8650);
		expect(s.stepsBest).toBe(12480);
		expect(s.kcalAvg).toBe(1000);
		expect(s.proteinAvg).toBe(69);
	});

	it('folds session and standalone pain into one worst-per-area', () => {
		const s = digestData(sources()).summary;
		// Lower back 6 + Hips 3 (standalone note), Shoulders 3 (session), Elbows 2
		// (one movement), worst first; Knees 9 is from July and must not show.
		expect(s.painWorst).toBe('Lower back:6, Hips:3, Shoulders:3, Elbows:2');
		expect(s.painEntries).toBe(1);
	});

	it('reports an empty window without inventing zeros', () => {
		const d = digestData(sources({ range: { from: '2026-06-01', to: '2026-06-07' } }));
		expect(d.workouts).toEqual([]);
		expect(d.summary.sessions).toBe(0);
		expect(d.summary.volumeKg).toBe(null);
		expect(d.summary.weightChange).toBe(null);
	});
});

describe('buildDigest text format', () => {
	const text = buildDigest(sources());

	it('leads with a version and the range it covers', () => {
		expect(text.split('\n')[0]).toBe('FOUNDRY-DIGEST v1');
		const meta = Object.fromEntries(section(text, 'META').map((l) => l.split('\t')));
		expect(meta).toMatchObject({
			from: '2026-07-31', to: '2026-08-06', days: '7', today: '2026-08-06',
			timezone: TZ, heightCm: '182', targetKcal: '2400'
		});
		// Nothing was set for carbs, so no key is invented for it.
		expect(meta.targetCarbs).toBeUndefined();
	});

	it('has only four kinds of line, so a parser needs no special cases', () => {
		for (const line of text.split('\n')) {
			if (line === '' || line === 'FOUNDRY-DIGEST v1') { continue; }
			if (line.startsWith('; ') || line.startsWith('# ')) { continue; }
			expect(line, 'record lines carry no prose').toMatch(/^[^;#]/);
		}
		// A header names its section first, then the columns of the rows beneath.
		expect(text).toContain('; a comment (starts with ";")');
	});

	it('writes one workout row per session, newest last, with local calendar fields', () => {
		const rows = section(text, 'WORKOUTS');
		expect(rows).toHaveLength(2);
		expect(rows[1].split('\t')).toEqual([
			'W2', '2026-08-04', 'Tue', '18:12', 'Gym', 'Chest', '7', '4', '800', '-', '-', 'Shoulders:3', 'felt strong'
		]);
	});

	it('encodes sets by what the numbers mean', () => {
		const rows = section(text, 'SETS').map((r) => r.split('\t'));
		const bench = rows.find((r) => r[1] === 'Bench Press')!;
		expect(bench).toEqual(['W2', 'Bench Press', 'kg', 'barbell', '-', '8x50,8x50', '800', '-', '-']);
		// No external load: reps only, and no volume in kilograms.
		expect(rows.find((r) => r[1] === 'Pull-up')).toEqual(['W2', 'Pull-up', 'bw', '-', '-', '8,6', '-', 'Elbows:2', '-']);
		// A timed hold puts seconds where the load goes, flagged by the unit.
		expect(rows.find((r) => r[1] === 'Plank')![2]).toBe('sec');
		expect(rows.find((r) => r[1] === 'Run')).toEqual(['W1', 'Run', 'cardio', '-', '-', 'min=32 km=6.2', '-', '-', '-']);
	});

	it('flattens tabs and newlines out of free text so a row stays a row', () => {
		const rows = section(text, 'NOTES');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toBe('2026-08-04\tShoulder twinge on pressing');
	});

	it('keeps every section header even when the range has no such data', () => {
		const empty = buildDigest(sources({ range: { from: '2026-06-01', to: '2026-06-07' } }));
		for (const name of ['META', 'SUMMARY', 'WORKOUTS', 'SETS', 'PAIN', 'STEPS', 'WEIGHT', 'NUTRITION', 'NOTES', 'GOALS', 'PROGRAMS']) {
			expect(empty).toContain(`# ${name}\t`);
		}
		expect(section(empty, 'WORKOUTS')).toEqual([]);
		// Goals and programs are current state, so they survive an empty window.
		expect(section(empty, 'GOALS')).toHaveLength(1);
	});

	it('spells out the load target and how to read the format', () => {
		expect(section(text, 'GOALS')[0]).toBe('exercise\tBench 100\t100 x5 barbell\tno');
		expect(text).toContain('"-" means not recorded. It never means zero.');
	});

	// The reason for TSV over JSON: the same facts, a fraction of the tokens. The
	// gap widens with volume (records repeat no keys) — ~1.6x on this sparse week,
	// ~4.6x over a 12-week block. The fixed costs here are the section headers and
	// the one-off preamble.
	it('stays smaller than the same data as JSON', () => {
		const records = text.split('\n').filter((l) => l && !l.startsWith('; ')).join('\n');
		expect(records.length).toBeLessThan(JSON.stringify(digestData(sources())).length / 1.5);
		expect(text.length).toBeLessThan(4000);
	});
});
