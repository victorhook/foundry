import { describe, it, expect } from 'vitest';
import { handleRpc, handleMessage, TOOLS, SUPPORTED_VERSIONS, RPC_ERRORS, type McpSources } from './mcp';

// Fixtures live in UTC so the day arithmetic is deterministic wherever the
// tests run.
const D = (iso: string) => Date.parse(iso);

const exercises = [
	{ id: 'ex-bench', name: 'Bench Press', type: 'strength', muscles: ['chest'], unit: 'kg', bodyweight: false },
	{ id: 'ex-bench-db', name: 'Dumbbell Bench Press', type: 'strength', muscles: ['chest'], unit: 'kg', bodyweight: false },
	{ id: 'ex-squat', name: 'Squat', type: 'strength', muscles: ['legs'], unit: 'kg', bodyweight: false },
	{ id: 'ex-run', name: 'Running', type: 'cardio', muscles: ['legs'], unit: 'km', bodyweight: true }
];

const workouts = [
	{
		id: 'w1',
		startedAt: D('2026-07-01T10:00:00Z'),
		routineName: 'Push',
		theme: 'Push',
		feel: 4,
		energy: 3,
		notes: 'solid',
		entries: [
			{ exerciseId: 'ex-bench', sets: [{ reps: 5, weight: 80 }, { reps: 5, weight: 80 }], note: '', pain: null }
		],
		pains: []
	},
	{
		id: 'w2',
		startedAt: D('2026-07-08T10:00:00Z'),
		routineName: 'Push',
		theme: 'Push',
		feel: 5,
		energy: 4,
		notes: '',
		entries: [
			{ exerciseId: 'ex-bench', sets: [{ reps: 5, weight: 85 }, { reps: 5, weight: 85 }], note: 'felt easy', pain: null },
			{ exerciseId: 'ex-squat', sets: [{ reps: 5, weight: 100 }], note: '', pain: { cat: 'knee', level: 3 } }
		],
		pains: [{ cat: 'shoulder', level: 2 }]
	},
	{
		id: 'w3',
		startedAt: D('2026-07-15T18:00:00Z'),
		routineName: 'Cardio',
		theme: 'Cardio',
		feel: 3,
		energy: 3,
		notes: '',
		entries: [{ exerciseId: 'ex-run', sets: [{ duration: 30, distance: 5.2, pace: null }], note: '', pain: null }],
		pains: []
	}
];

const foodLogs: Record<string, any[]> = {
	'2026-07-14': [
		{ slot: 'breakfast', name: 'Oats', grams: 100, qty: 1, kcal: 380, protein: 13, carbs: 60, fat: 7 },
		{ slot: 'lunch', name: 'Chicken', grams: 200, qty: 1, kcal: 330, protein: 62, carbs: 0, fat: 7 }
	],
	'2026-07-15': [{ slot: 'breakfast', name: 'Oats', grams: 100, qty: 1, kcal: 380, protein: 13, carbs: 60, fat: 7 }]
};

const sources: McpSources = {
	now: () => D('2026-07-15T20:00:00Z'),
	timezone: 'UTC',
	exercises: () => exercises,
	workouts: () => workouts,
	painNotes: () => [
		{ id: 'p1', at: D('2026-07-10T08:00:00Z'), note: 'woke up stiff', items: [{ cat: 'lower back', level: 4 }] }
	],
	notes: () => [
		{ id: 'n1', day: '2026-07-12', text: 'Deload week planned' },
		{ id: 'n2', day: '2026-06-01', text: 'Started new program' }
	],
	goals: () => [
		{ id: 'g1', kind: 'lift', title: 'Bench 100kg', target: 100, filter: null, done: false },
		{ id: 'g2', kind: 'habit', title: 'Walk daily', target: null, filter: null, done: true }
	],
	profile: () => ({ dob: '1990-01-01', height: 180, gender: 'male', targets: { kcal: 2400, protein: 180, carbs: 250, fat: 80 } }),
	bodyWeights: () => [
		{ id: 1, at: D('2026-07-01T07:00:00Z'), weight: 82.5 },
		{ id: 2, at: D('2026-07-15T07:00:00Z'), weight: 81.2 }
	],
	steps: () => [
		{ day: '2026-07-13', steps: 8000 },
		{ day: '2026-07-14', steps: 12000 },
		{ day: '2026-07-15', steps: 10000 }
	],
	foodLog: (day) => foodLogs[day] ?? [],
	templates: () => [
		{ id: 't1', name: 'Push day', entries: [{ exerciseId: 'ex-bench', setCount: 3, reps: 5, weight: 80 }] }
	]
};

/** Call a tool the way a client would, and hand back the parsed result. */
function call(name: string, args: Record<string, any> = {}) {
	const res = handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, sources);
	return (res as any).result as { structuredContent?: any; isError?: boolean; content: Array<{ text: string }> };
}

describe('protocol handshake', () => {
	it('answers a legacy initialize with the version the client asked for', () => {
		const res = handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, sources);
		expect((res as any).result.protocolVersion).toBe('2025-06-18');
		expect((res as any).result.capabilities.tools).toBeDefined();
		expect((res as any).result.serverInfo.name).toBe('foundry');
	});

	it('names a version it does support when the client asks for an unknown one', () => {
		const res = handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, sources);
		expect(SUPPORTED_VERSIONS).toContain((res as any).result.protocolVersion);
	});

	it('answers server/discover for modern clients', () => {
		const res = handleRpc({ jsonrpc: '2.0', id: 'd1', method: 'server/discover', params: {} }, sources);
		const r = (res as any).result;
		expect(r.supportedVersions).toEqual(SUPPORTED_VERSIONS);
		expect(r.resultType).toBe('complete');
		expect(r._meta['io.modelcontextprotocol/serverInfo'].name).toBe('foundry');
	});

	it('rejects a per-request protocol version it does not speak', () => {
		const res = handleRpc(
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } }
			},
			sources
		);
		expect((res as any).error.code).toBe(RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION);
		expect((res as any).error.data.supported).toEqual(SUPPORTED_VERSIONS);
	});

	it('accepts a per-request protocol version it does speak', () => {
		const res = handleRpc(
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: { _meta: { 'io.modelcontextprotocol/protocolVersion': SUPPORTED_VERSIONS[0] } }
			},
			sources
		);
		expect((res as any).result.tools.length).toBe(TOOLS.length);
	});

	it('says nothing back to a notification', () => {
		expect(handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, sources)).toBeNull();
	});

	it('rejects an unknown method', () => {
		const res = handleRpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' }, sources);
		expect((res as any).error.code).toBe(RPC_ERRORS.METHOD_NOT_FOUND);
	});

	it('handles a batch, dropping the notifications', () => {
		const res = handleMessage(
			[
				{ jsonrpc: '2.0', method: 'notifications/initialized' },
				{ jsonrpc: '2.0', id: 1, method: 'ping' }
			],
			sources
		);
		expect(Array.isArray(res)).toBe(true);
		expect(res).toHaveLength(1);
		expect((res as any)[0].id).toBe(1);
	});
});

describe('tools/list', () => {
	it('advertises every tool as read-only with a schema', () => {
		const res = handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, sources);
		const tools = (res as any).result.tools;
		expect(tools.length).toBeGreaterThan(0);
		for (const t of tools) {
			expect(t.annotations.readOnlyHint).toBe(true);
			expect(t.inputSchema.type).toBe('object');
			expect(t.description.length).toBeGreaterThan(20);
		}
	});

	it('reports an unknown tool as a tool error, not a transport error', () => {
		const r = call('drop_everything');
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('Unknown tool');
	});
});

describe('get_overview', () => {
	it('summarises what data exists', () => {
		const d = call('get_overview').structuredContent;
		expect(d.today).toBe('2026-07-15');
		expect(d.workouts.total).toBe(3);
		expect(d.workouts.firstDay).toBe('2026-07-01');
		expect(d.workouts.lastDay).toBe('2026-07-15');
		expect(d.workouts.last7Days).toBe(1); // window opens 2026-07-09, so w3 only (w2 is the 8th)
		expect(d.workouts.last28Days).toBe(3);
		expect(d.bodyWeight.latest).toEqual({ day: '2026-07-15', weight: 81.2 });
		expect(d.macroTargets.kcal).toBe(2400);
	});
});

describe('list_workouts', () => {
	it('returns sessions newest first with totals', () => {
		const d = call('list_workouts').structuredContent;
		expect(d.workouts.map((w: any) => w.id)).toEqual(['w3', 'w2', 'w1']);
		expect(d.workouts[2].volumeKg).toBe(800); // 5x80 twice
		expect(d.workouts[0].distanceKm).toBe(5.2);
	});

	it('filters by date range', () => {
		const d = call('list_workouts', { from: '2026-07-05', to: '2026-07-10' }).structuredContent;
		expect(d.workouts.map((w: any) => w.id)).toEqual(['w2']);
		expect(d.totalMatched).toBe(1);
	});

	it('filters by exercise name', () => {
		const d = call('list_workouts', { exercise: 'squat' }).structuredContent;
		expect(d.workouts.map((w: any) => w.id)).toEqual(['w2']);
	});

	it('honours limit and still reports the full match count', () => {
		const d = call('list_workouts', { limit: 1 }).structuredContent;
		expect(d.workouts).toHaveLength(1);
		expect(d.totalMatched).toBe(3);
		expect(d.returned).toBe(1);
	});

	it('rejects a malformed date', () => {
		const r = call('list_workouts', { from: '01/07/2026' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('YYYY-MM-DD');
	});
});

describe('get_workout', () => {
	it('returns one session set by set with names resolved', () => {
		const d = call('get_workout', { id: 'w2' }).structuredContent;
		expect(d.workout.exercises.map((e: any) => e.name)).toEqual(['Bench Press', 'Squat']);
		expect(d.workout.exercises[0].sets).toHaveLength(2);
		expect(d.workout.pains).toEqual([{ cat: 'shoulder', level: 2 }]);
	});

	it('explains an unknown id instead of returning nothing', () => {
		const r = call('get_workout', { id: 'nope' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('list_workouts');
	});
});

describe('search_exercises', () => {
	it('includes usage stats', () => {
		const d = call('search_exercises', { query: 'bench' }).structuredContent;
		const bench = d.exercises.find((e: any) => e.name === 'Bench Press');
		expect(bench.timesPerformed).toBe(2);
		expect(bench.lastPerformed).toBe('2026-07-08');
	});

	it('filters by muscle group', () => {
		const d = call('search_exercises', { muscle: 'chest' }).structuredContent;
		expect(d.exercises.map((e: any) => e.name)).toEqual(['Bench Press', 'Dumbbell Bench Press']);
	});
});

describe('get_exercise_history', () => {
	it('tracks one lift across sessions and reports the best set', () => {
		const d = call('get_exercise_history', { exercise: 'Bench Press' }).structuredContent;
		expect(d.totalSessions).toBe(2);
		expect(d.sessions[0].day).toBe('2026-07-08');
		expect(d.heaviestSet).toEqual({
			day: '2026-07-08',
			reps: 5,
			weight: 85,
			equipment: null,
			perSide: false
		});
		expect(d.bestVolumeKg).toEqual({ day: '2026-07-08', volumeKg: 850 });
	});

	it('asks for a narrower name when the match is ambiguous', () => {
		const r = call('get_exercise_history', { exercise: 'bench' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('matches 2 exercises');
	});

	it('resolves by id', () => {
		const d = call('get_exercise_history', { exercise: 'ex-squat' }).structuredContent;
		expect(d.exercise.name).toBe('Squat');
		expect(d.totalSessions).toBe(1);
	});

	it('reports an unknown exercise', () => {
		const r = call('get_exercise_history', { exercise: 'zercher carry' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('No exercise matching');
	});
});

describe('get_pain', () => {
	it('merges standalone, session and per-exercise pain, newest first', () => {
		const d = call('get_pain').structuredContent;
		expect(d.entries.map((e: any) => e.source)).toEqual(['pain_note', 'workout', 'exercise']);
		expect(d.entries[0].items).toEqual([{ cat: 'lower back', level: 4 }]);
		expect(d.entries[2].exercise).toBe('Squat');
	});

	it('filters by category', () => {
		const d = call('get_pain', { category: 'knee' }).structuredContent;
		expect(d.totalMatched).toBe(1);
		expect(d.entries[0].source).toBe('exercise');
	});
});

describe('get_nutrition', () => {
	it('totals each logged day and skips empty ones', () => {
		const d = call('get_nutrition', { from: '2026-07-13', to: '2026-07-15' }).structuredContent;
		expect(d.days.map((x: any) => x.day)).toEqual(['2026-07-14', '2026-07-15']);
		expect(d.days[0].kcal).toBe(710);
		expect(d.days[0].protein).toBe(75);
		expect(d.daysInRange).toBe(3);
		expect(d.averages.kcal).toBe(545);
		expect(d.targets.kcal).toBe(2400);
	});

	it('omits individual entries unless asked', () => {
		expect(call('get_nutrition', { from: '2026-07-14', to: '2026-07-14' }).structuredContent.days[0].entries).toBeUndefined();
		const detailed = call('get_nutrition', { from: '2026-07-14', to: '2026-07-14', detail: true }).structuredContent;
		expect(detailed.days[0].entries).toHaveLength(2);
	});

	it('defaults to the fortnight ending today', () => {
		const d = call('get_nutrition').structuredContent;
		expect(d.to).toBe('2026-07-15');
		expect(d.from).toBe('2026-07-02');
	});

	it('refuses a range that would swamp the context window', () => {
		const r = call('get_nutrition', { from: '2020-01-01', to: '2026-07-15' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('maximum per call');
	});

	it('rejects a backwards range', () => {
		const r = call('get_nutrition', { from: '2026-07-15', to: '2026-07-01' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('is after');
	});
});

describe('get_body_weight, get_steps, get_notes, get_goals, list_templates', () => {
	it('reports weight change across the range', () => {
		const d = call('get_body_weight').structuredContent;
		expect(d.count).toBe(2);
		expect(d.changeKg).toBe(-1.3);
	});

	it('averages steps over the days recorded', () => {
		const d = call('get_steps', { from: '2026-07-13', to: '2026-07-15' }).structuredContent;
		expect(d.total).toBe(30000);
		expect(d.dailyAverage).toBe(10000);
	});

	it('searches note text', () => {
		const d = call('get_notes', { query: 'deload' }).structuredContent;
		expect(d.notes).toHaveLength(1);
		expect(d.notes[0].day).toBe('2026-07-12');
	});

	it('can hide completed goals', () => {
		expect(call('get_goals').structuredContent.count).toBe(2);
		expect(call('get_goals', { includeDone: false }).structuredContent.count).toBe(1);
	});

	it('resolves exercise names in templates', () => {
		const d = call('list_templates').structuredContent;
		expect(d.templates[0].entries[0].exercise).toBe('Bench Press');
	});
});
