import { describe, it, expect } from 'vitest';
import { buildSnapshot, mondayOf, recentDays, enrichWorkout } from './snapshot';

// Date handling is the part most likely to produce a confidently wrong answer:
// "summarize this week" hinges on which Monday the agent thinks it is.
describe('mondayOf', () => {
	it('returns the same day for a Monday', () => {
		expect(mondayOf('2026-07-20')).toBe('2026-07-20'); // a Monday
	});

	it('walks back to Monday from mid-week', () => {
		expect(mondayOf('2026-07-23')).toBe('2026-07-20'); // Thursday
	});

	it('treats Sunday as the end of the week, not the start', () => {
		expect(mondayOf('2026-07-26')).toBe('2026-07-20'); // Sunday
	});

	it('crosses a month boundary', () => {
		expect(mondayOf('2026-08-02')).toBe('2026-07-27'); // Sunday → previous Mon
	});

	it('crosses a year boundary', () => {
		expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // Friday → previous Mon
	});
});

describe('recentDays', () => {
	it('ends at today and is oldest-first', () => {
		expect(recentDays('2026-07-26', 3)).toEqual(['2026-07-24', '2026-07-25', '2026-07-26']);
	});

	it('spans a month boundary', () => {
		expect(recentDays('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
	});

	it('handles a leap day', () => {
		expect(recentDays('2028-03-01', 2)).toEqual(['2028-02-29', '2028-03-01']);
	});

	it('returns just today for n=1', () => {
		expect(recentDays('2026-07-26', 1)).toEqual(['2026-07-26']);
	});
});

describe('buildSnapshot', () => {
	const base = {
		// 2026-07-23T09:00:00Z — a Thursday.
		now: Date.UTC(2026, 6, 23, 9, 0, 0),
		timezone: 'UTC',
		exercises: [{ id: 'bench', name: 'Bench Press', type: 'strength', unit: 'kg' }],
		workouts: [{ id: 'w1', startedAt: Date.UTC(2026, 6, 22), routineName: 'Gym', entries: [] }],
		bodyWeights: [{ id: 'b1', at: Date.UTC(2026, 6, 20), weight: 82.5 }],
		steps: [{ day: '2026-07-22', steps: 8000 }],
		notes: [{ id: 'n1', day: '2026-07-22', text: 'felt strong' }],
		goals: [{ id: 'g1', kind: 'weekly', title: 'Gym 3x', target: 3 }],
		profile: { dob: '1990-01-01', height: 180, targets: { kcal: 2600, protein: 180, carbs: null, fat: null } },
		foodLog: {},
		counts: { photos: 3, albums: 1, foods: 120, meals: 4, templates: 2, programs: 1 }
	};

	it('pre-computes today and the week start in the given timezone', () => {
		const s = buildSnapshot(base);
		expect(s.today).toBe('2026-07-23');
		expect(s.weekStartMonday).toBe('2026-07-20');
		expect(s.timezone).toBe('UTC');
	});

	it('resolves `today` against the timezone, not UTC', () => {
		// 23:30 UTC on the 22nd is already the 23rd in Stockholm (UTC+2 in July).
		const s = buildSnapshot({
			...base,
			now: Date.UTC(2026, 6, 22, 23, 30),
			timezone: 'Europe/Stockholm'
		});
		expect(s.today).toBe('2026-07-23');
	});

	it('passes untransformed collections through by reference', () => {
		const s = buildSnapshot(base);
		expect(s.exercises).toBe(base.exercises);
		expect(s.bodyWeights).toBe(base.bodyWeights);
		expect(s.counts.photos).toBe(3);
	});

	it('enriches workouts rather than passing them through raw', () => {
		const s = buildSnapshot(base);
		expect(s.workouts).not.toBe(base.workouts);
		// The fields that exist so the agent never shells out for them.
		expect(s.workouts[0]).toMatchObject({ day: '2026-07-22', weekday: 'Wed' });
		expect(s.workouts[0]).toHaveProperty('weekStartMonday');
		expect(s.workouts[0]).toHaveProperty('exercises');
	});

	// The agent decides whether to query with jq or read the file wholesale based
	// on these, and reading a multi-hundred-KB export blows its context budget.
	it('counts every collection so the agent can size the file before reading it', () => {
		const s = buildSnapshot({ ...base, foodLog: { '2026-07-22': [{ kcal: 1 }] } });
		expect(s.counts).toMatchObject({
			workouts: 1,
			exercises: 1,
			bodyWeights: 1,
			stepDays: 1,
			notes: 1,
			goals: 1,
			nutritionDays: 1,
			photos: 3,
			foods: 120
		});
	});

	it('mirrors the profile targets under nutrition, where a diet question looks', () => {
		expect(buildSnapshot(base).nutrition.targets).toEqual(base.profile.targets);
	});

	it('sorts food-diary days oldest-first and drops empty ones', () => {
		const s = buildSnapshot({
			...base,
			foodLog: {
				'2026-07-22': [{ name: 'Oats', kcal: 350 }],
				'2026-07-21': [],
				'2026-07-20': [{ name: 'Rice', kcal: 400 }]
			}
		});
		expect(s.nutrition.days.map((d) => d.day)).toEqual(['2026-07-20', '2026-07-22']);
	});

	it('tells the agent up front that the work is already done', () => {
		const readme = buildSnapshot(base)._readme;
		expect(readme).toContain('weekStartMonday');
		expect(readme).toContain('PRE-COMPUTED');
		expect(readme).toContain('ALREADY RESOLVED'); // no exerciseId lookups
		expect(readme).toContain('"sec"');            // the sec-as-load gotcha
		expect(readme).toMatch(/not zero/);           // absent != zero
	});

	// The recipes are the difference between a one-command answer and fifteen.
	it('ships ready-made queries for the common questions', () => {
		const r = buildSnapshot(base)._recipes;
		expect(Object.keys(r)).toContain('thisWeek');
		expect(Object.keys(r)).toContain('oneExerciseOverTime');
		expect(Object.keys(r)).toContain('weeklyVolume');
		for (const q of Object.values(r)) {
			expect(q).toContain('foundry-data.json');
		}
	});

	it('tolerates a profile with no targets set', () => {
		const s = buildSnapshot({ ...base, profile: { dob: null, height: null } });
		expect(s.nutrition.targets).toBeNull();
	});
});

// Enrichment exists to stop the agent shelling out for date maths and id joins,
// so the derived fields have to be right — a wrong volume is worse than none.
describe('enrichWorkout', () => {
	const bench = { id: 'b', name: 'Bench Press', type: 'strength', unit: 'kg', bodyweight: false, muscles: ['Chest'] };
	const plank = { id: 'p', name: 'Plank', type: 'strength', unit: 'sec', bodyweight: true, muscles: ['Core'] };
	const pullup = { id: 'u', name: 'Pull-up', type: 'strength', unit: 'kg', bodyweight: true, muscles: ['Back'] };
	const run = { id: 'run', name: 'Run', type: 'cardio', unit: 'kg', bodyweight: false, muscles: ['Cardio'] };
	const exById = new Map([bench, plank, pullup, run].map((e) => [e.id, e]));

	// 2026-07-27T16:00:00Z — a Monday; 18:00 in Stockholm (UTC+2 in July).
	const monday = Date.UTC(2026, 6, 27, 16, 0);

	it('resolves calendar fields in the user timezone, not UTC', () => {
		const w = enrichWorkout({ id: 'w', startedAt: monday, entries: [] }, exById, 'Europe/Stockholm');
		expect(w.day).toBe('2026-07-27');
		expect(w.weekday).toBe('Mon');
		expect(w.time).toBe('18:00');
		expect(w.weekStartMonday).toBe('2026-07-27');
	});

	it('resolves exercise names so no id lookup is needed', () => {
		const w = enrichWorkout(
			{ id: 'w', startedAt: monday, entries: [{ exerciseId: 'b', sets: [{ reps: 8, weight: 80 }] }] },
			exById,
			'UTC'
		);
		expect(w.exercises[0].name).toBe('Bench Press');
		expect(w.exercises[0].muscles).toEqual(['Chest']);
		expect(w.exercises[0].setCount).toBe(1);
	});

	it('sums load across sets and across exercises', () => {
		const w = enrichWorkout(
			{
				id: 'w',
				startedAt: monday,
				entries: [
					{ exerciseId: 'b', sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 82.5 }] },
					{ exerciseId: 'b', sets: [{ reps: 5, weight: 90 }] }
				]
			},
			exById,
			'UTC'
		);
		// 640 + 660 = 1300, then 450
		expect(w.exercises[0].volumeKg).toBe(1300);
		expect(w.exercises[1].volumeKg).toBe(450);
		expect(w.volumeKg).toBe(1750);
	});

	it('reports no volume for a seconds-based hold', () => {
		const w = enrichWorkout(
			{ id: 'w', startedAt: monday, entries: [{ exerciseId: 'p', sets: [{ reps: 1, weight: 60 }] }] },
			exById,
			'UTC'
		);
		// 60 is seconds, not kilograms — summing it would invent a 60 kg lift.
		expect(w.exercises[0].volumeKg).toBeNull();
		expect(w.volumeKg).toBeNull();
	});

	it('reports no volume for a bodyweight exercise', () => {
		const w = enrichWorkout(
			{ id: 'w', startedAt: monday, entries: [{ exerciseId: 'u', sets: [{ reps: 10, weight: 0 }] }] },
			exById,
			'UTC'
		);
		expect(w.exercises[0].volumeKg).toBeNull();
	});

	it('totals cardio duration and distance instead of volume', () => {
		const w = enrichWorkout(
			{ id: 'w', startedAt: monday, entries: [{ exerciseId: 'run', sets: [{ duration: 28, distance: 5.2 }] }] },
			exById,
			'UTC'
		);
		expect(w.durationMin).toBe(28);
		expect(w.distanceKm).toBe(5.2);
		expect(w.volumeKg).toBeNull();
	});

	it('skips sets with missing numbers rather than counting them as zero', () => {
		const w = enrichWorkout(
			{ id: 'w', startedAt: monday, entries: [{ exerciseId: 'b', sets: [{ reps: 8, weight: 80 }, { reps: 8 }] }] },
			exById,
			'UTC'
		);
		expect(w.exercises[0].volumeKg).toBe(640);
	});

	it('keeps an unknown exercise id visible instead of dropping the entry', () => {
		const w = enrichWorkout(
			{ id: 'w', startedAt: monday, entries: [{ exerciseId: 'gone', sets: [] }] },
			exById,
			'UTC'
		);
		expect(w.exercises[0].name).toBe('gone');
		expect(w.exercises[0].volumeKg).toBeNull();
	});

	it('carries notes and pain through', () => {
		const w = enrichWorkout(
			{
				id: 'w', startedAt: monday, notes: 'felt strong', feel: 8, energy: 4,
				pains: [{ cat: 'Knees', level: 3 }],
				entries: [{ exerciseId: 'b', sets: [], note: 'right side weaker', pain: { cat: 'Shoulders', level: 2 } }]
			},
			exById,
			'UTC'
		);
		expect(w.notes).toBe('felt strong');
		expect(w.feel).toBe(8);
		expect(w.pains).toEqual([{ cat: 'Knees', level: 3 }]);
		expect(w.exercises[0].note).toBe('right side weaker');
		expect(w.exercises[0].pain).toEqual({ cat: 'Shoulders', level: 2 });
	});
});

describe('buildSnapshot week filtering', () => {
	it('counts only this week, using the pre-computed Monday', () => {
		const ex = [{ id: 'b', name: 'Bench', type: 'strength', unit: 'kg' }];
		const mk = (ts: number) => ({ id: 'w' + ts, startedAt: ts, routineName: 'Gym', entries: [] });
		const s = buildSnapshot({
			now: Date.UTC(2026, 6, 30, 12),   // Thursday
			timezone: 'UTC',
			exercises: ex,
			workouts: [
				mk(Date.UTC(2026, 6, 27, 12)),  // Mon, this week
				mk(Date.UTC(2026, 6, 29, 12)),  // Wed, this week
				mk(Date.UTC(2026, 6, 24, 12))   // previous Friday
			],
			bodyWeights: [], steps: [], notes: [], goals: [],
			profile: {}, foodLog: {}, counts: {}
		});
		expect(s.weekStartMonday).toBe('2026-07-27');
		expect(s.counts.workoutsThisWeek).toBe(2);
		expect(s.counts.workouts).toBe(3);
	});
});

// Pain is the one thing recorded in two unrelated places, so the export has to
// surface both — a "how's my knee" answer built from half the data is worse than
// no answer, because it reads as authoritative.
describe('pain notes in the export', () => {
	const base = {
		now: Date.UTC(2026, 6, 30, 12),
		timezone: 'Europe/Stockholm',
		exercises: [], workouts: [], bodyWeights: [], steps: [], notes: [], goals: [],
		profile: {}, foodLog: {}, counts: {}
	};

	it('resolves calendar fields and sorts oldest-first', () => {
		const s = buildSnapshot({
			...base,
			painNotes: [
				{ id: 'b', at: Date.UTC(2026, 6, 26, 16), note: 'worse', items: [{ cat: 'Knees', level: 6 }] },
				{ id: 'a', at: Date.UTC(2026, 6, 22, 6), note: 'twinge', items: [{ cat: 'Knees', level: 3 }] }
			]
		});
		expect(s.painNotes.map((p: any) => p.id)).toEqual(['a', 'b']);
		expect(s.painNotes[0]).toMatchObject({ day: '2026-07-22', weekday: 'Wed', time: '08:00' });
		expect(s.painNotes[1]).toMatchObject({ day: '2026-07-26', weekday: 'Sun' });
	});

	it('reports the worst level in a multi-area entry', () => {
		const s = buildSnapshot({
			...base,
			painNotes: [
				{ id: 'x', at: Date.UTC(2026, 6, 28, 10), note: '', items: [{ cat: 'Knees', level: 2 }, { cat: 'Hips', level: 7 }] }
			]
		});
		expect(s.painNotes[0].worst).toBe(7);
	});

	it('leaves worst null when an entry is note-only', () => {
		const s = buildSnapshot({
			...base,
			painNotes: [{ id: 'x', at: Date.UTC(2026, 6, 28, 10), note: 'stiff all over', items: [] }]
		});
		expect(s.painNotes[0].worst).toBeNull();
		expect(s.painNotes[0].note).toBe('stiff all over');
	});

	it('counts them, and copes with none at all', () => {
		expect(buildSnapshot({ ...base, painNotes: [{ id: 'x', at: Date.now(), items: [] }] }).counts.painNotes).toBe(1);
		expect(buildSnapshot(base).painNotes).toEqual([]);
		expect(buildSnapshot(base).counts.painNotes).toBe(0);
	});

	it('warns the agent that pain is recorded in two places', () => {
		const readme = buildSnapshot(base)._readme;
		expect(readme).toContain('TWO PLACES');
		expect(readme).toContain('painNotes[]');
		expect(readme).toContain('exercises[].pain');
	});

	it('ships a recipe for each of those two places', () => {
		const r = buildSnapshot(base)._recipes;
		expect(Object.keys(r)).toContain('painForAreaStandalone');
		expect(Object.keys(r)).toContain('painForAreaInSession');
	});
});
