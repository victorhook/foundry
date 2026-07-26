import fs from 'node:fs';
import path from 'node:path';
import {
	getExercises,
	getWorkouts,
	getBodyWeights,
	getStepDays,
	getNotes,
	getGoals,
	getProfile,
	getFoodLog,
	getPhotos,
	getAlbums,
	getFoods,
	getMeals,
	getTemplates,
	getPrograms
} from './db';
import { buildSnapshot, localDay, recentDays, NUTRITION_DAYS, SNAPSHOT_FILE } from './snapshot';

// The AI chat agent has no database connection and no API credentials — by
// design, so nothing in the sandbox can write to Foundry or exfiltrate a token.
// Instead we dump the owner's data to a JSON file in its workspace before each
// turn, and tell it in the system prompt where that file is. Reading a local file
// is something the agent is already good at, and it can't go stale: it's
// rewritten every turn.
//
// Kept separate from ./snapshot because importing ./db opens SQLite at module
// load — which a unit test importing the pure builder must not do.

/**
 * Write the data export into the agent's workspace. Returns the absolute path,
 * or null if it couldn't be written — a chat turn is still useful without data,
 * so this never throws into the turn.
 */
export function writeSnapshot(workspace: string, tz?: string): string | null {
	try {
		const now = Date.now();
		const today = localDay(now, tz);
		const foodLog: Record<string, unknown[]> = {};
		for (const day of recentDays(today, NUTRITION_DAYS)) {
			const entries = getFoodLog(day);
			if (entries.length) { foodLog[day] = entries; }
		}
		const snapshot = buildSnapshot({
			now,
			timezone: tz,
			exercises: getExercises(),
			workouts: getWorkouts(),
			bodyWeights: getBodyWeights(),
			steps: getStepDays(),
			notes: getNotes(),
			goals: getGoals(),
			profile: getProfile(),
			foodLog,
			counts: {
				photos: getPhotos().length,
				albums: getAlbums().length,
				foods: getFoods().length,
				meals: getMeals().length,
				templates: getTemplates().length,
				programs: getPrograms().length
			}
		});

		fs.mkdirSync(workspace, { recursive: true });
		const file = path.join(workspace, SNAPSHOT_FILE);
		// Replace rather than truncate: the previous copy is written read-only.
		fs.rmSync(file, { force: true });
		fs.writeFileSync(file, JSON.stringify(snapshot, null, '\t'), { mode: 0o444 });
		return file;
	} catch (e) {
		return null;
	}
}
