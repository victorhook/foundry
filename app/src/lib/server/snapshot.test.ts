import { describe, it, expect } from 'vitest';
import { buildSnapshot, mondayOf, recentDays } from './snapshot';

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

	it('passes the collections through untouched', () => {
		const s = buildSnapshot(base);
		expect(s.workouts).toBe(base.workouts);
		expect(s.exercises).toBe(base.exercises);
		expect(s.bodyWeights).toBe(base.bodyWeights);
		expect(s.counts.photos).toBe(3);
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

	it('explains units and the date fields in the readme the agent reads first', () => {
		const readme = buildSnapshot(base)._readme;
		expect(readme).toContain('weekStartMonday');
		expect(readme).toContain('epoch milliseconds');
		expect(readme).toContain('"sec"'); // the sec-as-load gotcha
		expect(readme).toMatch(/not zero/); // absent ≠ zero
	});

	it('tolerates a profile with no targets set', () => {
		const s = buildSnapshot({ ...base, profile: { dob: null, height: null } });
		expect(s.nutrition.targets).toBeNull();
	});
});
