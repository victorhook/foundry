import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db.ts resolves its file at import time and opens it immediately, so the env
// has to point at a throwaway DB before the module is pulled in.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-ex-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
const db = await import('./db');

const newExercise = (name: string) =>
	db.createExercise({
		name,
		muscles: ['Legs'],
		bodyweight: false,
		unit: 'kg',
		image: null,
		equipment: [],
		unilateral: false
	})!;

// Removing a movement from the library has to take its references with it —
// nothing points at exercise.id through a real FK, so a missed table would show
// up in the app as an "Unknown" row that can never be cleaned up.
describe('deleteExercise', () => {
	it('removes an unused exercise', () => {
		const ex = newExercise('Sissy Squat');
		expect(db.exerciseUsage(ex.id)).toEqual({ workouts: 0, templates: 0, goals: 0 });
		expect(db.deleteExercise(ex.id)).toBe(true);
		expect(db.getExercise(ex.id)).toBe(null);
	});

	it('takes logged entries, template rows and PB goals with it', () => {
		const ex = newExercise('Hack Squat');
		const other = newExercise('Leg Press');
		db.createWorkout({
			startedAt: Date.now(),
			routineName: null,
			feel: null,
			energy: null,
			notes: 'leg day',
			entries: [
				{ exerciseId: ex.id, sets: [{ reps: 8, weight: 60 }] },
				{ exerciseId: other.id, sets: [{ reps: 10, weight: 100 }] }
			],
			pains: [{ cat: 'Knees', level: 3 }]
		});
		const tpl = db.saveTemplate({
			name: 'Legs',
			entries: [{ exerciseId: ex.id, setCount: 3 }, { exerciseId: other.id, setCount: 3 }]
		})!;
		db.createGoal({ kind: 'exercise', title: 'Hack squat PB', exerciseId: ex.id, targetValue: 100 } as any);

		expect(db.exerciseUsage(ex.id)).toEqual({ workouts: 1, templates: 1, goals: 1 });
		expect(db.deleteExercise(ex.id)).toBe(true);

		// Gone from the library, and no reference to it survives anywhere.
		expect(db.getExercise(ex.id)).toBe(null);
		expect(db.getGoals().some((g: any) => g.exerciseId === ex.id)).toBe(false);
		const savedTpl = db.getTemplates().find((t: any) => t.id === tpl.id)!;
		expect(savedTpl.entries.map((e: any) => e.exerciseId)).toEqual([other.id]);

		// The session itself stays — its date, notes and pain log are still true.
		const w = db.getWorkouts().at(-1)!;
		expect(w.notes).toBe('leg day');
		expect(w.pains).toEqual([{ cat: 'Knees', level: 3 }]);
		expect(w.entries.map((e: any) => e.exerciseId)).toEqual([other.id]);
		// The removed entry's sets went with it (ON DELETE CASCADE).
		expect(w.entries[0].sets).toEqual([{ reps: 10, weight: 100 }]);
	});

	it('refuses seeded cardio and unknown ids', () => {
		expect(db.deleteExercise('run')).toBe(false);
		expect(db.getExercise('run')).not.toBe(null);
		expect(db.deleteExercise('nope')).toBe(false);
	});
});
