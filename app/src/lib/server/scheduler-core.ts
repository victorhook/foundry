// Pure scheduling logic — no DB / env / push imports, so it unit-tests in plain
// Node without side effects. scheduler.ts wires these to the real data + timer.

import type { Reminder } from './db';

export type LocalNow = { ymd: string; hm: string; day: number };

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Current wall-clock in the given timezone (e.g. "Europe/Stockholm"; undefined =
// system tz), broken into the pieces a reminder schedule is expressed in:
// ymd (YYYY-MM-DD), hm (HH:MM, 24h), and day (0=Sun..6=Sat, matching Date.getDay).
export function localNow(now: Date, tz?: string): LocalNow {
	const ymd = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
	}).format(now);
	const hm = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
	}).format(now);
	const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
	return { ymd, hm, day: WD[wd] ?? 0 };
}

// Which reminders should fire at this local minute? Enabled, today's weekday bit
// set, exact time match, and not already fired today (dedupe via lastFired).
export function dueReminders(reminders: Reminder[], t: LocalNow): Reminder[] {
	return reminders.filter(
		(r) =>
			r.enabled &&
			(r.days & (1 << t.day)) !== 0 &&
			r.time === t.hm &&
			r.lastFired !== t.ymd
	);
}
