import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';
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
	(d) => d.exec("ALTER TABLE exercise ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg'"),
	// v6 -> v7: single-row person profile.
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS profile (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			dob TEXT,
			height REAL,
			gender TEXT
		)`),
	// v7 -> v8: body-weight history (weigh-ins over time).
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS body_weight (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			at INTEGER NOT NULL,
			weight REAL NOT NULL,
			created_at INTEGER NOT NULL
		)`),
	// v8 -> v9: photo albums.
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS album (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`),
	// v9 -> v10: photos (files on disk, metadata here).
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS photo (
			id TEXT PRIMARY KEY,
			album_id TEXT REFERENCES album(id) ON DELETE SET NULL,
			filename TEXT NOT NULL,
			mime TEXT,
			caption TEXT,
			tags TEXT,
			taken_at INTEGER,
			created_at INTEGER NOT NULL
		)`),
	// v10 -> v11: reusable gym templates (pre-defined workouts with default sets).
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS workout_template (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT,
			ord INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS template_entry (
			id TEXT PRIMARY KEY,
			template_id TEXT NOT NULL REFERENCES workout_template(id) ON DELETE CASCADE,
			exercise_id TEXT NOT NULL,
			ord INTEGER NOT NULL,
			set_count INTEGER,
			reps INTEGER,
			weight REAL
		)`),
	// v11 -> v12: nutrition — food library, saved meals, and the daily diary.
	// Macros (kcal/protein/carbs/fat) are stored PER SERVING; a logged entry
	// multiplies by qty. Names + macros are snapshotted onto meal_item/food_log
	// so editing or deleting a food never rewrites saved meals or past days.
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS food (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			serving TEXT,
			kcal REAL, protein REAL, carbs REAL, fat REAL,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS meal (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			icon TEXT,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS meal_item (
			id TEXT PRIMARY KEY,
			meal_id TEXT NOT NULL REFERENCES meal(id) ON DELETE CASCADE,
			food_id TEXT,
			ord INTEGER NOT NULL,
			qty REAL NOT NULL DEFAULT 1,
			name TEXT NOT NULL,
			kcal REAL, protein REAL, carbs REAL, fat REAL
		);
		CREATE TABLE IF NOT EXISTS food_log (
			id TEXT PRIMARY KEY,
			day TEXT NOT NULL,
			slot TEXT NOT NULL,
			ord INTEGER NOT NULL,
			food_id TEXT,
			qty REAL NOT NULL DEFAULT 1,
			name TEXT NOT NULL,
			kcal REAL, protein REAL, carbs REAL, fat REAL,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_food_log_day ON food_log(day)`),
	// v12 -> v13: optional daily nutrition targets on the single-row profile.
	(d) =>
		d.exec(`ALTER TABLE profile ADD COLUMN kcal_target REAL;
		ALTER TABLE profile ADD COLUMN protein_target REAL;
		ALTER TABLE profile ADD COLUMN carbs_target REAL;
		ALTER TABLE profile ADD COLUMN fat_target REAL`),
	// v13 -> v14: a workout "theme" (e.g. "Shoulders", "Knee rehab") + a reusable bank.
	(d) =>
		d.exec(`ALTER TABLE workout ADD COLUMN theme TEXT;
		CREATE TABLE IF NOT EXISTS workout_theme (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL
		)`),
	// v14 -> v15: exercise image + uploaded training programs / rehab plans / events.
	(d) =>
		d.exec(`ALTER TABLE exercise ADD COLUMN image TEXT;
		CREATE TABLE IF NOT EXISTS program (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			kind TEXT,
			filename TEXT,
			mime TEXT,
			start_date TEXT,
			notes TEXT,
			created_at INTEGER NOT NULL
		)`),
	// v15 -> v16: free-text notes bound to a date (daily status journal).
	(d) =>
		d.exec(`CREATE TABLE IF NOT EXISTS note (
			id TEXT PRIMARY KEY,
			day TEXT NOT NULL,
			text TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_note_day ON note(day)`),
	// v16 -> v17: nutrition rework — food macros are now PER 100g + a food image;
	// meals/log entries reference a gram amount (macros computed from it); meals
	// can be flagged "everyday" with a default slot for one-tap daily logging.
	(d) =>
		d.exec(`ALTER TABLE food ADD COLUMN image TEXT;
		ALTER TABLE meal ADD COLUMN everyday INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE meal ADD COLUMN slot TEXT;
		ALTER TABLE meal_item ADD COLUMN grams REAL;
		ALTER TABLE food_log ADD COLUMN grams REAL`),
	// v17 -> v18: seed a library of common basic foods (Sweden-relevant) with
	// macros per 100 g, so the food list isn't empty to start with. Only inserts a
	// food if one with the same name doesn't already exist, so it never clobbers
	// anything the user added. Values are approximate, from public food databases.
	(d) => {
		// [name, kcal, protein, carbs, fat] per 100 g. Raw/uncooked unless noted.
		const foods = [
			// Vegetables
			['Potato', 77, 2, 17, 0.1],
			['Sweet potato', 86, 1.6, 20, 0.1],
			['Carrot', 41, 0.9, 10, 0.2],
			['Broccoli', 34, 2.8, 7, 0.4],
			['Cauliflower', 25, 1.9, 5, 0.3],
			['Yellow onion', 40, 1.1, 9, 0.1],
			['Tomato', 18, 0.9, 3.9, 0.2],
			['Cucumber', 15, 0.7, 3.6, 0.1],
			['Bell pepper (paprika)', 31, 1, 6, 0.3],
			['Spinach', 23, 2.9, 3.6, 0.4],
			['Lettuce', 15, 1.4, 2.9, 0.2],
			['White cabbage (vitkål)', 25, 1.3, 6, 0.1],
			['Kale (grönkål)', 49, 4.3, 9, 0.9],
			['Green peas (ärtor)', 81, 5.4, 14, 0.4],
			['Green beans', 31, 1.8, 7, 0.1],
			['Beetroot (rödbeta)', 43, 1.6, 10, 0.2],
			['Mushrooms (champinjoner)', 22, 3.1, 3.3, 0.3],
			['Zucchini', 17, 1.2, 3.1, 0.3],
			['Avocado', 160, 2, 9, 15],
			['Sweetcorn', 86, 3.2, 19, 1.2],
			// Fruit & berries
			['Apple', 52, 0.3, 14, 0.2],
			['Banana', 89, 1.1, 23, 0.3],
			['Orange', 47, 0.9, 12, 0.1],
			['Pear', 57, 0.4, 15, 0.1],
			['Grapes', 69, 0.7, 18, 0.2],
			['Kiwi', 61, 1.1, 15, 0.5],
			['Strawberries (jordgubbar)', 32, 0.7, 8, 0.3],
			['Blueberries (blåbär)', 57, 0.7, 14, 0.3],
			['Lingonberries (lingon)', 54, 0.5, 12, 0.5],
			['Raspberries (hallon)', 52, 1.2, 12, 0.7],
			// Dairy & eggs
			['Egg', 143, 13, 1.1, 9.5],
			['Milk 3% (mellanmjölk)', 60, 3.4, 4.8, 3],
			['Milk 1.5%', 45, 3.4, 4.8, 1.5],
			['Milk 0.5% (lättmjölk)', 35, 3.4, 5, 0.5],
			['Natural yoghurt (3%)', 60, 3.3, 4.7, 3],
			['Greek yoghurt (10%)', 133, 5.7, 4, 10],
			['Filmjölk 3%', 56, 3.3, 4.3, 3],
			['Kvarg (quark), natural', 61, 11, 4, 0.2],
			['Cottage cheese (keso)', 98, 11, 3.4, 4.3],
			['Hard cheese (hushållsost)', 350, 26, 0.5, 27],
			['Butter (smör)', 717, 0.9, 0.1, 81],
			['Whipping cream 40% (grädde)', 340, 2.1, 3, 36],
			['Crème fraiche', 290, 2.4, 3.4, 30],
			// Meat, fish & protein
			['Chicken breast', 120, 23, 0, 2.6],
			['Chicken thigh', 177, 24, 0, 8],
			['Ground beef 10% (nötfärs)', 176, 20, 0, 10],
			['Beef steak', 217, 26, 0, 12],
			['Pork chop', 231, 26, 0, 14],
			['Bacon', 540, 37, 1.4, 42],
			['Cooked ham (skinka)', 110, 18, 1.5, 3.5],
			['Falukorv', 250, 11, 8, 20],
			['Salmon (lax)', 208, 20, 0, 13],
			['Cod (torsk)', 82, 18, 0, 0.7],
			['Herring (sill)', 158, 18, 0, 9],
			['Shrimp (räkor)', 99, 24, 0.2, 0.3],
			['Tuna, canned in water', 116, 26, 0, 1],
			['Tofu', 76, 8, 1.9, 4.8],
			// Grains, bread & staples
			['White rice, cooked', 130, 2.7, 28, 0.3],
			['Pasta, cooked', 158, 6, 31, 0.9],
			['Oats (havregryn)', 389, 17, 66, 7],
			['Wholegrain bread (fullkornsbröd)', 250, 9, 43, 3.5],
			['Rye bread (rågbröd)', 259, 8.5, 48, 3.3],
			['Crispbread (knäckebröd)', 334, 9, 66, 2],
			['Muesli', 360, 9, 66, 6],
			['Couscous, cooked', 112, 3.8, 23, 0.2],
			['Quinoa, cooked', 120, 4.4, 21, 1.9],
			// Legumes & nuts
			['Lentils, cooked', 116, 9, 20, 0.4],
			['Chickpeas, cooked', 164, 8.9, 27, 2.6],
			['Kidney beans, cooked', 127, 8.7, 23, 0.5],
			['Almonds', 579, 21, 22, 50],
			['Peanuts', 567, 26, 16, 49],
			['Peanut butter', 588, 25, 20, 50],
			// Fats, sweeteners & other
			['Olive oil', 884, 0, 0, 100],
			['Rapeseed oil (rapsolja)', 884, 0, 0, 100],
			['Sugar', 387, 0, 100, 0],
			['Honey', 304, 0.3, 82, 0],
			['Hummus', 166, 8, 14, 10]
		];
		const exists = d.prepare('SELECT 1 FROM food WHERE name = ? LIMIT 1');
		const ins = d.prepare(
			'INSERT INTO food (id, name, image, kcal, protein, carbs, fat, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)'
		);
		const now = Date.now();
		let i = 0;
		for (const row of foods) {
			const [name, kcal, protein, carbs, fat] = row;
			if (exists.get(name)) continue;
			ins.run('seed-' + i++, name, kcal, protein, carbs, fat, now);
		}
	}
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
		} else if (!building && process.env.NODE_ENV === 'production') {
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
		.prepare('SELECT id, name, type, muscle, bodyweight, unit, image, custom FROM exercise ORDER BY name')
		.all()
		.map((r: any) => ({
			id: r.id,
			name: r.name,
			type: r.type,
			muscles: splitMuscles(r.muscle),
			bodyweight: !!r.bodyweight,
			unit: r.unit || 'kg',
			image: r.image || null,
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

export function getWorkoutThemes(): string[] {
	return db
		.prepare('SELECT name FROM workout_theme ORDER BY name')
		.all()
		.map((r: any) => r.name);
}

function rememberTheme(name: string) {
	const n = (name || '').trim();
	if (n) {
		db.prepare('INSERT OR IGNORE INTO workout_theme (name) VALUES (?)').run(n);
	}
}

export function createWorkoutTheme(name: string): string {
	rememberTheme(name);
	return name.trim();
}

export function getWorkouts() {
	const workouts = db
		.prepare('SELECT id, started_at, routine_name, theme, feel, energy, notes FROM workout ORDER BY started_at')
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
		theme: w.theme || null,
		feel: w.feel,
		energy: w.energy,
		notes: w.notes || '',
		entries: entriesByWorkout[w.id] || [],
		pains: painsByWorkout[w.id] || []
	}));
}

// Edit an existing workout's date and/or theme.
export function updateWorkout(id: string, patch: { startedAt?: number; theme?: string | null }) {
	const cur = db.prepare('SELECT started_at, theme FROM workout WHERE id = ?').get(id) as any;
	if (!cur) { return null; }
	const startedAt = patch.startedAt != null ? patch.startedAt : cur.started_at;
	const theme = patch.theme !== undefined ? ((patch.theme || '').trim() || null) : cur.theme;
	db.prepare('UPDATE workout SET started_at = ?, theme = ? WHERE id = ?').run(startedAt, theme, id);
	if (theme) { rememberTheme(theme); }
	return getWorkouts().find((w) => w.id === id) || null;
}

export function getProfile() {
	const r = db
		.prepare('SELECT dob, height, gender, kcal_target, protein_target, carbs_target, fat_target FROM profile WHERE id = 1')
		.get() as any;
	const base = r || { dob: null, height: null, gender: null };
	return {
		dob: base.dob ?? null,
		height: base.height ?? null,
		gender: base.gender ?? null,
		targets: {
			kcal: base.kcal_target ?? null,
			protein: base.protein_target ?? null,
			carbs: base.carbs_target ?? null,
			fat: base.fat_target ?? null
		}
	};
}

export function saveTargets(t: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }) {
	db.prepare(
		`INSERT INTO profile (id, kcal_target, protein_target, carbs_target, fat_target) VALUES (1, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET kcal_target = excluded.kcal_target, protein_target = excluded.protein_target,
			carbs_target = excluded.carbs_target, fat_target = excluded.fat_target`
	).run(t.kcal, t.protein, t.carbs, t.fat);
	return getProfile();
}

export function getBodyWeights() {
	return db
		.prepare('SELECT id, at, weight FROM body_weight ORDER BY at')
		.all()
		.map((r: any) => ({ id: r.id, at: r.at, weight: r.weight }));
}

export function getAlbums() {
	return db.prepare('SELECT id, name, created_at FROM album ORDER BY created_at DESC').all() as any[];
}

export function getPhotos() {
	return db
		.prepare('SELECT id, album_id, mime, caption, tags, taken_at, created_at FROM photo ORDER BY COALESCE(taken_at, created_at) DESC')
		.all()
		.map((r: any) => ({
			id: r.id,
			albumId: r.album_id,
			mime: r.mime,
			caption: r.caption || '',
			tags: (r.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
			takenAt: r.taken_at,
			createdAt: r.created_at
		}));
}

export function getTemplates() {
	const tpls = db
		.prepare('SELECT id, name, icon, ord FROM workout_template ORDER BY ord, created_at')
		.all() as any[];
	const entries = db
		.prepare('SELECT template_id, exercise_id, set_count, reps, weight FROM template_entry ORDER BY ord')
		.all() as any[];
	const byTpl: Record<string, any[]> = {};
	for (const e of entries) {
		(byTpl[e.template_id] ||= []).push({
			exerciseId: e.exercise_id,
			setCount: e.set_count,
			reps: e.reps,
			weight: e.weight
		});
	}
	return tpls.map((t) => ({
		id: t.id,
		name: t.name,
		icon: t.icon || null,
		entries: byTpl[t.id] || []
	}));
}

function getTemplate(id: string) {
	return getTemplates().find((t) => t.id === id) || null;
}

type TemplateInput = {
	id?: string;
	name: string;
	icon?: string | null;
	ord?: number;
	entries: { exerciseId: string; setCount?: number | null; reps?: number | null; weight?: number | null }[];
};

export const saveTemplate = db.transaction((t: TemplateInput) => {
	const id = t.id || uid();
	const exists = db.prepare('SELECT id FROM workout_template WHERE id = ?').get(id);
	if (exists) {
		db.prepare('UPDATE workout_template SET name = ?, icon = ? WHERE id = ?').run(t.name, t.icon ?? null, id);
		db.prepare('DELETE FROM template_entry WHERE template_id = ?').run(id);
	} else {
		db.prepare(
			'INSERT INTO workout_template (id, name, icon, ord, created_at) VALUES (?, ?, ?, ?, ?)'
		).run(id, t.name, t.icon ?? null, t.ord ?? 0, Date.now());
	}
	const ins = db.prepare(
		'INSERT INTO template_entry (id, template_id, exercise_id, ord, set_count, reps, weight) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	(t.entries || []).forEach((e, i) =>
		ins.run(uid(), id, e.exerciseId, i, e.setCount ?? null, e.reps ?? null, e.weight ?? null)
	);
	return getTemplate(id);
});

export function deleteTemplate(id: string) {
	db.prepare('DELETE FROM workout_template WHERE id = ?').run(id);
}

/* ---- Training programs / rehab plans / events (uploaded documents) ---- */
export function getPrograms() {
	return db
		.prepare("SELECT id, title, kind, filename, mime, start_date, notes, created_at FROM program ORDER BY COALESCE(start_date, '') DESC, created_at DESC")
		.all()
		.map((r: any) => ({
			id: r.id,
			title: r.title,
			kind: r.kind || 'program',
			filename: r.filename || null,
			mime: r.mime || null,
			startDate: r.start_date || null,
			notes: r.notes || '',
			createdAt: r.created_at
		}));
}

export function createProgram(p: any) {
	const id = uid();
	db.prepare(
		'INSERT INTO program (id, title, kind, filename, mime, start_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(id, p.title, p.kind ?? 'program', p.filename ?? null, p.mime ?? null, p.startDate ?? null, p.notes ?? '', Date.now());
	return getPrograms().find((x) => x.id === id) || null;
}

export function updateProgram(id: string, p: any) {
	const cur = db.prepare('SELECT * FROM program WHERE id = ?').get(id) as any;
	if (!cur) { return null; }
	db.prepare('UPDATE program SET title = ?, kind = ?, filename = ?, mime = ?, start_date = ?, notes = ? WHERE id = ?').run(
		p.title ?? cur.title,
		p.kind ?? cur.kind,
		p.filename !== undefined ? p.filename : cur.filename,
		p.mime !== undefined ? p.mime : cur.mime,
		p.startDate !== undefined ? p.startDate : cur.start_date,
		p.notes !== undefined ? p.notes : cur.notes,
		id
	);
	return getPrograms().find((x) => x.id === id) || null;
}

/* ---- Date-bound notes (daily status journal) ---- */
export function getNotes() {
	return db
		.prepare('SELECT id, day, text, created_at FROM note ORDER BY day DESC, created_at DESC')
		.all()
		.map((r: any) => ({ id: r.id, day: r.day, text: r.text, createdAt: r.created_at }));
}

export function createNote(day: string, text: string) {
	const id = uid();
	db.prepare('INSERT INTO note (id, day, text, created_at) VALUES (?, ?, ?, ?)').run(id, day, text, Date.now());
	return getNotes().find((n) => n.id === id) || null;
}

export function updateNote(id: string, patch: { day?: string; text?: string }) {
	const cur = db.prepare('SELECT day, text FROM note WHERE id = ?').get(id) as any;
	if (!cur) { return null; }
	db.prepare('UPDATE note SET day = ?, text = ? WHERE id = ?').run(
		patch.day ?? cur.day,
		patch.text !== undefined ? patch.text : cur.text,
		id
	);
	return getNotes().find((n) => n.id === id) || null;
}

export function deleteNote(id: string) {
	db.prepare('DELETE FROM note WHERE id = ?').run(id);
}

export function getProgramFile(id: string) {
	return db.prepare('SELECT filename, mime FROM program WHERE id = ?').get(id) as
		| { filename: string; mime: string }
		| undefined;
}

export function deleteProgram(id: string) {
	const row = getProgramFile(id);
	db.prepare('DELETE FROM program WHERE id = ?').run(id);
	return row;
}

/* ---- Nutrition: food library ---- */
const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

// Food macros are stored PER 100g (kcal/protein/carbs/fat) + an optional image.
export function getFoods() {
	return db
		.prepare('SELECT id, name, image, kcal, protein, carbs, fat FROM food ORDER BY name')
		.all()
		.map((r: any) => ({ id: r.id, name: r.name, image: r.image || null, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat }));
}

export function createFood(f: any) {
	const id = uid();
	db.prepare(
		'INSERT INTO food (id, name, image, kcal, protein, carbs, fat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(id, f.name, f.image ?? null, num(f.kcal), num(f.protein), num(f.carbs), num(f.fat), Date.now());
	return getFoods().find((x) => x.id === id);
}

export function updateFood(id: string, f: any) {
	db.prepare('UPDATE food SET name = ?, image = ?, kcal = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?').run(
		f.name, f.image ?? null, num(f.kcal), num(f.protein), num(f.carbs), num(f.fat), id
	);
	return getFoods().find((x) => x.id === id);
}

export function deleteFood(id: string) {
	db.prepare('DELETE FROM food WHERE id = ?').run(id);
}

/* ---- Nutrition: saved meals (bundles of foods, each with a gram amount) ---- */
export function getMeals() {
	const meals = db.prepare('SELECT id, name, icon, everyday, slot FROM meal ORDER BY name').all() as any[];
	const items = db
		.prepare('SELECT meal_id, food_id, grams, qty, name, kcal, protein, carbs, fat FROM meal_item ORDER BY ord')
		.all() as any[];
	const byMeal: Record<string, any[]> = {};
	for (const it of items) {
		(byMeal[it.meal_id] ||= []).push({
			foodId: it.food_id,
			grams: it.grams,
			qty: it.qty,
			name: it.name,
			kcal: it.kcal,
			protein: it.protein,
			carbs: it.carbs,
			fat: it.fat
		});
	}
	return meals.map((m) => ({
		id: m.id,
		name: m.name,
		icon: m.icon || null,
		everyday: !!m.everyday,
		slot: m.slot || null,
		items: byMeal[m.id] || []
	}));
}

function getMeal(id: string) {
	return getMeals().find((m) => m.id === id) || null;
}

export const saveMeal = db.transaction((m: any) => {
	const id = m.id || uid();
	const exists = db.prepare('SELECT id FROM meal WHERE id = ?').get(id);
	if (exists) {
		db.prepare('UPDATE meal SET name = ?, icon = ?, everyday = ?, slot = ? WHERE id = ?').run(m.name, m.icon ?? null, m.everyday ? 1 : 0, m.slot ?? null, id);
		db.prepare('DELETE FROM meal_item WHERE meal_id = ?').run(id);
	} else {
		db.prepare('INSERT INTO meal (id, name, icon, everyday, slot, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, m.name, m.icon ?? null, m.everyday ? 1 : 0, m.slot ?? null, Date.now());
	}
	const ins = db.prepare(
		'INSERT INTO meal_item (id, meal_id, food_id, ord, grams, qty, name, kcal, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	(m.items || []).forEach((it: any, i: number) =>
		ins.run(uid(), id, it.foodId ?? null, i, num(it.grams), num(it.qty) ?? 1, it.name, num(it.kcal), num(it.protein), num(it.carbs), num(it.fat))
	);
	return getMeal(id);
});

export function deleteMeal(id: string) {
	db.prepare('DELETE FROM meal WHERE id = ?').run(id);
}

/* ---- Nutrition: daily diary ---- */
export function getFoodLog(day: string) {
	return db
		.prepare('SELECT id, day, slot, ord, food_id, grams, qty, name, kcal, protein, carbs, fat FROM food_log WHERE day = ? ORDER BY slot, ord, created_at')
		.all(day)
		.map((r: any) => ({
			id: r.id, day: r.day, slot: r.slot, foodId: r.food_id, grams: r.grams, qty: r.qty,
			name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat
		}));
}

// Insert one or more entries into a day/slot. Returns the day's full log.
export const addFoodLog = db.transaction((day: string, slot: string, entries: any[]) => {
	const row = db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM food_log WHERE day = ? AND slot = ?').get(day, slot) as any;
	let ord = (row.m as number) + 1;
	const ins = db.prepare(
		'INSERT INTO food_log (id, day, slot, ord, food_id, grams, qty, name, kcal, protein, carbs, fat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (const e of entries) {
		ins.run(uid(), day, slot, ord++, e.foodId ?? null, num(e.grams), num(e.qty) ?? 1, e.name, num(e.kcal), num(e.protein), num(e.carbs), num(e.fat), Date.now());
	}
	return getFoodLog(day);
});

export function updateFoodLog(id: string, patch: any) {
	const cur = db.prepare('SELECT * FROM food_log WHERE id = ?').get(id) as any;
	if (!cur) { return null; }
	db.prepare('UPDATE food_log SET slot = ?, grams = ?, qty = ?, name = ?, kcal = ?, protein = ?, carbs = ?, fat = ? WHERE id = ?').run(
		patch.slot ?? cur.slot,
		patch.grams !== undefined ? num(patch.grams) : cur.grams,
		patch.qty != null ? num(patch.qty) : cur.qty,
		patch.name ?? cur.name,
		patch.kcal !== undefined ? num(patch.kcal) : cur.kcal,
		patch.protein !== undefined ? num(patch.protein) : cur.protein,
		patch.carbs !== undefined ? num(patch.carbs) : cur.carbs,
		patch.fat !== undefined ? num(patch.fat) : cur.fat,
		id
	);
	return getFoodLog(cur.day);
}

export function deleteFoodLog(id: string) {
	const cur = db.prepare('SELECT day FROM food_log WHERE id = ?').get(id) as any;
	db.prepare('DELETE FROM food_log WHERE id = ?').run(id);
	return cur ? getFoodLog(cur.day) : [];
}

export function getAllData() {
	return {
		exercises: getExercises(),
		painCategories: getPainCategories(),
		muscleGroups: getMuscleGroups(),
		workouts: getWorkouts(),
		workoutThemes: getWorkoutThemes(),
		templates: getTemplates(),
		programs: getPrograms(),
		notes: getNotes(),
		foods: getFoods(),
		meals: getMeals(),
		profile: getProfile(),
		bodyWeights: getBodyWeights(),
		albums: getAlbums(),
		photos: getPhotos()
	};
}

// --- Profile / weight ---
export function saveProfile(p: { dob: string | null; height: number | null; gender: string | null }) {
	db.prepare(
		`INSERT INTO profile (id, dob, height, gender) VALUES (1, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET dob = excluded.dob, height = excluded.height, gender = excluded.gender`
	).run(p.dob, p.height, p.gender);
	return getProfile();
}

export function addBodyWeight(at: number, weight: number) {
	const info = db
		.prepare('INSERT INTO body_weight (at, weight, created_at) VALUES (?, ?, ?)')
		.run(at, weight, Date.now());
	return { id: info.lastInsertRowid as number, at, weight };
}

export function deleteBodyWeight(id: number) {
	db.prepare('DELETE FROM body_weight WHERE id = ?').run(id);
}

// --- Albums / photos ---
export function createAlbum(name: string) {
	const id = uid();
	const created_at = Date.now();
	db.prepare('INSERT INTO album (id, name, created_at) VALUES (?, ?, ?)').run(id, name, created_at);
	return { id, name, created_at };
}

export function deleteAlbum(id: string) {
	db.prepare('DELETE FROM album WHERE id = ?').run(id);
}

export function addPhoto(p: {
	albumId: string | null;
	filename: string;
	mime: string;
	caption: string;
	tags: string[];
	takenAt: number | null;
}) {
	const id = uid();
	const created_at = Date.now();
	db.prepare(
		'INSERT INTO photo (id, album_id, filename, mime, caption, tags, taken_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(id, p.albumId, p.filename, p.mime, p.caption, p.tags.join(','), p.takenAt, created_at);
	return {
		id,
		albumId: p.albumId,
		mime: p.mime,
		caption: p.caption,
		tags: p.tags,
		takenAt: p.takenAt,
		createdAt: created_at
	};
}

export function getPhotoFile(id: string) {
	return db.prepare('SELECT filename, mime FROM photo WHERE id = ?').get(id) as
		| { filename: string; mime: string }
		| undefined;
}

export function deletePhoto(id: string) {
	const row = getPhotoFile(id);
	db.prepare('DELETE FROM photo WHERE id = ?').run(id);
	return row;
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

export function createExercise(name: string, muscles: string[], bodyweight: boolean, unit: string, image: string | null) {
	const id = uid();
	const clean = muscles.map((m) => m.trim()).filter(Boolean);
	db.prepare(
		'INSERT INTO exercise (id, name, type, muscle, bodyweight, unit, image, custom, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
	).run(id, name, 'strength', clean.join(','), bodyweight ? 1 : 0, unit, image ?? null, Date.now());
	rememberMuscles(clean);
	return { id, name, type: 'strength', muscles: clean, bodyweight, unit, image: image ?? null, custom: true };
}

export function updateExercise(id: string, name: string, muscles: string[], bodyweight: boolean, unit: string, image: string | null) {
	const clean = muscles.map((m) => m.trim()).filter(Boolean);
	db.prepare('UPDATE exercise SET name = ?, muscle = ?, bodyweight = ?, unit = ?, image = ? WHERE id = ?').run(
		name,
		clean.join(','),
		bodyweight ? 1 : 0,
		unit,
		image ?? null,
		id
	);
	rememberMuscles(clean);
	const r = db.prepare('SELECT id, name, type, muscle, bodyweight, unit, image, custom FROM exercise WHERE id = ?').get(id) as any;
	return {
		id: r.id,
		name: r.name,
		type: r.type,
		muscles: splitMuscles(r.muscle),
		bodyweight: !!r.bodyweight,
		unit: r.unit || 'kg',
		image: r.image || null,
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
	theme?: string | null;
	feel: number | null;
	energy: number | null;
	notes: string;
	entries: { exerciseId: string; sets: SetInput[]; note?: string; pain?: { cat: string; level: number } | null }[];
	pains: { cat: string; level: number }[];
};

const isStrengthSet = (s: SetInput) => s.reps != null || s.weight != null;

export const createWorkout = db.transaction((w: WorkoutInput) => {
	const id = uid();
	const theme = (w.theme || '').trim() || null;
	db.prepare(
		'INSERT INTO workout (id, started_at, routine_name, theme, feel, energy, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(id, w.startedAt, w.routineName, theme, w.feel, w.energy, w.notes, Date.now());
	if (theme) { rememberTheme(theme); }

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
		theme,
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
