import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { hashPassword } from './auth';

const DB_PATH = env.DATABASE_PATH || 'data/foundry.db';

// Cardio activities back the Bike/Run/Walk/Interval categories and are hidden
// from the gym picker. The gym library starts empty (user builds it).
const SEED_EXERCISES = [
	{ id: 'run', name: 'Run', type: 'cardio', muscle: 'Cardio' },
	{ id: 'walk', name: 'Walk', type: 'cardio', muscle: 'Cardio' },
	{ id: 'bike', name: 'Cycling', type: 'cardio', muscle: 'Cardio' },
	{ id: 'bike_int', name: 'Bike Intervals', type: 'cardio', muscle: 'Cardio' }
];
const SEED_PAIN_CATEGORIES = ['Lower back', 'Knees', 'Shoulders', 'Elbows', 'Wrists', 'Hips', 'Neck'];
const SEED_MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Calves'];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
	CREATE TABLE IF NOT EXISTS user (
		id INTEGER PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS exercise (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		muscle TEXT,
		custom INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS pain_category (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL
	);
	CREATE TABLE IF NOT EXISTS workout (
		id TEXT PRIMARY KEY,
		started_at INTEGER NOT NULL,
		routine_name TEXT,
		feel INTEGER,
		energy INTEGER,
		notes TEXT,
		created_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS workout_entry (
		id TEXT PRIMARY KEY,
		workout_id TEXT NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
		exercise_id TEXT NOT NULL,
		ord INTEGER NOT NULL,
		duration REAL,
		distance REAL,
		note TEXT,
		pain_cat TEXT,
		pain_level INTEGER
	);
	CREATE TABLE IF NOT EXISTS workout_pain (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		workout_id TEXT NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
		cat TEXT NOT NULL,
		level INTEGER NOT NULL
	);
`);

// --- Migrations ---
// The CREATE TABLE block above is the FROZEN baseline (schema version 1). Never
// edit it to change existing tables. To evolve the schema, append a migration
// function below; it runs once, in order, tracked via SQLite's user_version.
// A migration N upgrades the DB from version (BASELINE + N) to (BASELINE + N + 1).
//
//   Example — add a column later:
//   (d) => d.exec('ALTER TABLE workout ADD COLUMN bodyweight REAL')
const BASELINE_VERSION = 1;
const migrations: Array<(d: Database.Database) => void> = [
	// v1 -> v2: per-set reps + weight for strength exercises.
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS workout_set (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			entry_id TEXT NOT NULL REFERENCES workout_entry(id) ON DELETE CASCADE,
			ord INTEGER NOT NULL,
			reps INTEGER,
			weight REAL
		)`),
	// v2 -> v3: reusable tag / muscle-group "data bank".
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS muscle_group (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL
		)`),
	// v3 -> v4: walk pace ("normal"/"fast") stored on the cardio entry.
	(d) => d.exec('ALTER TABLE workout_entry ADD COLUMN pace TEXT'),
	// v4 -> v5: bodyweight exercises (reps only, no weight).
	(d) => d.exec('ALTER TABLE exercise ADD COLUMN bodyweight INTEGER NOT NULL DEFAULT 0'),
	// v5 -> v6: unit for the load field ("kg" default, or "sec" for timed holds).
	(d) => d.exec("ALTER TABLE exercise ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg'")
];

function migrate() {
	let v = db.pragma('user_version', { simple: true }) as number;
	if (v === 0) {
		// Fresh DB (baseline just created) or a pre-migration DB → mark as baseline.
		v = BASELINE_VERSION;
		db.pragma(`user_version = ${v}`);
	}
	const target = BASELINE_VERSION + migrations.length;
	for (; v < target; v++) {
		const step = migrations[v - BASELINE_VERSION];
		db.transaction(() => {
			step(db);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}
migrate();

// --- Seed ---
function seed() {
	const now = Date.now();
	const insEx = db.prepare(
		'INSERT OR IGNORE INTO exercise (id, name, type, muscle, custom, created_at) VALUES (?, ?, ?, ?, 0, ?)'
	);
	for (const e of SEED_EXERCISES) {
		insEx.run(e.id, e.name, e.type, e.muscle, now);
	}
	const painCount = (db.prepare('SELECT COUNT(*) AS n FROM pain_category').get() as { n: number }).n;
	if (painCount === 0) {
		const insPain = db.prepare('INSERT OR IGNORE INTO pain_category (name) VALUES (?)');
		for (const name of SEED_PAIN_CATEGORIES) {
			insPain.run(name);
		}
	}
	const mgCount = (db.prepare('SELECT COUNT(*) AS n FROM muscle_group').get() as { n: number }).n;
	if (mgCount === 0) {
		const insMg = db.prepare('INSERT OR IGNORE INTO muscle_group (name) VALUES (?)');
		for (const name of SEED_MUSCLE_GROUPS) {
			insMg.run(name);
		}
	}
	// Single user from env, created once.
	const userCount = (db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n;
	if (userCount === 0) {
		if (env.ADMIN_USER && env.ADMIN_PASSWORD) {
			db.prepare('INSERT INTO user (username, password_hash) VALUES (?, ?)').run(
				env.ADMIN_USER,
				hashPassword(env.ADMIN_PASSWORD)
			);
		} else if (process.env.NODE_ENV === 'production') {
			throw new Error(
				'No user exists yet and ADMIN_USER/ADMIN_PASSWORD are not set. ' +
					'Set them in .env so the initial login can be created.'
			);
		}
	}
}
seed();

// --- Auth queries ---
export function getUserByName(username: string) {
	return db.prepare('SELECT id, username, password_hash FROM user WHERE username = ?').get(username) as
		| { id: number; username: string; password_hash: string }
		| undefined;
}

// --- Data queries ---
// `muscle` is stored as a comma-separated list; exposed as a `muscles` array (tags).
function splitMuscles(s: string | null): string[] {
	return (s || '')
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean);
}

export function getExercises() {
	return db
		.prepare('SELECT id, name, type, muscle, bodyweight, unit, custom FROM exercise ORDER BY name')
		.all()
		.map((r: any) => ({
			id: r.id,
			name: r.name,
			type: r.type,
			muscles: splitMuscles(r.muscle),
			bodyweight: !!r.bodyweight,
			unit: r.unit || 'kg',
			custom: !!r.custom
		}));
}

export function getPainCategories(): string[] {
	return db
		.prepare('SELECT name FROM pain_category ORDER BY id')
		.all()
		.map((r: any) => r.name);
}

export function getMuscleGroups(): string[] {
	return db
		.prepare('SELECT name FROM muscle_group ORDER BY name')
		.all()
		.map((r: any) => r.name);
}

export function getWorkouts() {
	const workouts = db
		.prepare('SELECT id, started_at, routine_name, feel, energy, notes FROM workout ORDER BY started_at')
		.all() as any[];
	const entries = db
		.prepare('SELECT * FROM workout_entry ORDER BY ord')
		.all() as any[];
	const pains = db.prepare('SELECT workout_id, cat, level FROM workout_pain').all() as any[];
	const strengthSets = db
		.prepare('SELECT entry_id, reps, weight FROM workout_set ORDER BY ord')
		.all() as any[];

	const setsByEntry: Record<string, any[]> = {};
	for (const s of strengthSets) {
		(setsByEntry[s.entry_id] ||= []).push({ reps: s.reps, weight: s.weight });
	}

	const entriesByWorkout: Record<string, any[]> = {};
	for (const e of entries) {
		// Strength: sets come from workout_set. Cardio: a single duration/distance
		// (+ optional pace) lives on the entry row.
		let sets: any[] = setsByEntry[e.id] || [];
		if (!sets.length && (e.duration != null || e.distance != null || e.pace)) {
			sets = [{ duration: e.duration, distance: e.distance, pace: e.pace || null }];
		}
		(entriesByWorkout[e.workout_id] ||= []).push({
			exerciseId: e.exercise_id,
			sets,
			note: e.note || '',
			pain: e.pain_cat ? { cat: e.pain_cat, level: e.pain_level } : null
		});
	}
	const painsByWorkout: Record<string, any[]> = {};
	for (const p of pains) {
		(painsByWorkout[p.workout_id] ||= []).push({ cat: p.cat, level: p.level });
	}

	return workouts.map((w) => ({
		id: w.id,
		startedAt: w.started_at,
		routineName: w.routine_name,
		feel: w.feel,
		energy: w.energy,
		notes: w.notes || '',
		entries: entriesByWorkout[w.id] || [],
		pains: painsByWorkout[w.id] || []
	}));
}

export function getAllData() {
	return {
		exercises: getExercises(),
		painCategories: getPainCategories(),
		muscleGroups: getMuscleGroups(),
		workouts: getWorkouts()
	};
}

// --- Mutations ---
function uid() {
	return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

// Any tags on an exercise are folded into the reusable data bank.
function rememberMuscles(muscles: string[]) {
	const ins = db.prepare('INSERT OR IGNORE INTO muscle_group (name) VALUES (?)');
	for (const m of muscles) {
		if (m) {
			ins.run(m);
		}
	}
}

export function createExercise(name: string, muscles: string[], bodyweight: boolean, unit: string) {
	const id = uid();
	const clean = muscles.map((m) => m.trim()).filter(Boolean);
	db.prepare(
		'INSERT INTO exercise (id, name, type, muscle, bodyweight, unit, custom, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
	).run(id, name, 'strength', clean.join(','), bodyweight ? 1 : 0, unit, Date.now());
	rememberMuscles(clean);
	return { id, name, type: 'strength', muscles: clean, bodyweight, unit, custom: true };
}

export function updateExercise(id: string, name: string, muscles: string[], bodyweight: boolean, unit: string) {
	const clean = muscles.map((m) => m.trim()).filter(Boolean);
	db.prepare('UPDATE exercise SET name = ?, muscle = ?, bodyweight = ?, unit = ? WHERE id = ?').run(
		name,
		clean.join(','),
		bodyweight ? 1 : 0,
		unit,
		id
	);
	rememberMuscles(clean);
	const r = db.prepare('SELECT id, name, type, muscle, bodyweight, unit, custom FROM exercise WHERE id = ?').get(id) as any;
	return {
		id: r.id,
		name: r.name,
		type: r.type,
		muscles: splitMuscles(r.muscle),
		bodyweight: !!r.bodyweight,
		unit: r.unit || 'kg',
		custom: !!r.custom
	};
}

export function createPainCategory(name: string): string {
	db.prepare('INSERT OR IGNORE INTO pain_category (name) VALUES (?)').run(name);
	return name;
}

export function createMuscleGroup(name: string): string {
	db.prepare('INSERT OR IGNORE INTO muscle_group (name) VALUES (?)').run(name);
	return name;
}

type SetInput = { duration?: number; distance?: number; pace?: string | null; reps?: number; weight?: number };
type WorkoutInput = {
	startedAt: number;
	routineName: string | null;
	feel: number | null;
	energy: number | null;
	notes: string;
	entries: { exerciseId: string; sets: SetInput[]; note?: string; pain?: { cat: string; level: number } | null }[];
	pains: { cat: string; level: number }[];
};

const isStrengthSet = (s: SetInput) => s.reps != null || s.weight != null;

export const createWorkout = db.transaction((w: WorkoutInput) => {
	const id = uid();
	db.prepare(
		'INSERT INTO workout (id, started_at, routine_name, feel, energy, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(id, w.startedAt, w.routineName, w.feel, w.energy, w.notes, Date.now());

	const insEntry = db.prepare(
		'INSERT INTO workout_entry (id, workout_id, exercise_id, ord, duration, distance, pace, note, pain_cat, pain_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	const insSet = db.prepare(
		'INSERT INTO workout_set (entry_id, ord, reps, weight) VALUES (?, ?, ?, ?)'
	);
	w.entries.forEach((e, i) => {
		const entryId = uid();
		const sets = e.sets || [];
		const strength = sets.filter(isStrengthSet);
		const cardio = sets.find((s) => !isStrengthSet(s)) || {};
		insEntry.run(
			entryId,
			id,
			e.exerciseId,
			i,
			cardio.duration ?? null,
			cardio.distance ?? null,
			cardio.pace ?? null,
			e.note || null,
			e.pain?.cat ?? null,
			e.pain?.level ?? null
		);
		strength.forEach((s, j) => insSet.run(entryId, j, s.reps ?? null, s.weight ?? null));
	});

	const insPain = db.prepare('INSERT INTO workout_pain (workout_id, cat, level) VALUES (?, ?, ?)');
	for (const p of w.pains) {
		insPain.run(id, p.cat, p.level);
	}

	return {
		id,
		startedAt: w.startedAt,
		routineName: w.routineName,
		feel: w.feel,
		energy: w.energy,
		notes: w.notes,
		entries: w.entries.map((e) => ({
			exerciseId: e.exerciseId,
			sets: e.sets || [],
			note: e.note || '',
			pain: e.pain || null
		})),
		pains: w.pains
	};
});
