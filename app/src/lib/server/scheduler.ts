// In-process reminder scheduler.
//
// The whole point of a reminder is to fire when the app is NOT open, so this
// can't be client-driven like Fit sync. A single setInterval (~every minute)
// checks the per-weekday reminders against the current local time and sends a
// Web Push. Lives in the long-running adapter-node process (foundry.service,
// Restart=always). `lastFired` (YYYY-MM-DD) dedupes so each fires once/day even
// if the tick lands on the same minute twice.

import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { getReminders, updateReminder } from './db';
import { pushConfigured, sendPushToAll } from './push';
import { localNow, dueReminders } from './scheduler-core';

async function tick(now = new Date()) {
	if (!pushConfigured()) {
		return;
	}
	const t = localNow(now, env.TZ);
	const due = dueReminders(getReminders(), t);
	if (!due.length) {
		return;
	}
	// Mark first (so a slow push send can't cause a duplicate on the next tick),
	// then send a single notification regardless of how many reminders coincide.
	for (const r of due) {
		updateReminder(r.id, { lastFired: t.ymd });
	}
	await sendPushToAll({
		title: 'Foundry',
		body: 'Time to log your pain 🩹',
		url: '/pain',
		tag: 'foundry-pain-reminder'
	});
}

let started = false;
export function startScheduler() {
	// Don't run during build analysis; only meaningful when push is configured.
	if (started || building || !pushConfigured()) {
		return;
	}
	started = true;
	setInterval(() => {
		tick().catch(() => {
			/* never let a bad tick kill the interval */
		});
	}, 60_000);
}
