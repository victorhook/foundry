import { describe, it, expect } from 'vitest';
import { localNow, dueReminders } from './scheduler-core';

// bit i => JS getDay()===i (0=Sun..6=Sat)
const MON = 1 << 1, TUE = 1 << 2, WED = 1 << 3;
const r = (o: Partial<import('./db').Reminder>) => ({
	id: o.id ?? 'x', days: o.days ?? 0, time: o.time ?? '09:00',
	enabled: o.enabled ?? true, lastFired: o.lastFired ?? null, createdAt: 0
});

describe('localNow', () => {
	it('breaks a UTC instant into local parts for a timezone', () => {
		// 2026-07-20 07:30:00Z is a Monday; in Stockholm (UTC+2 summer) that's 09:30.
		const t = localNow(new Date('2026-07-20T07:30:00Z'), 'Europe/Stockholm');
		expect(t).toEqual({ ymd: '2026-07-20', hm: '09:30', day: 1 });
	});
	it('rolls the local date across midnight', () => {
		// 23:30Z Monday → 01:30 Tuesday in Stockholm.
		const t = localNow(new Date('2026-07-20T23:30:00Z'), 'Europe/Stockholm');
		expect(t).toEqual({ ymd: '2026-07-21', hm: '01:30', day: 2 });
	});
});

describe('dueReminders', () => {
	const now = { ymd: '2026-07-20', hm: '09:00', day: 1 }; // Monday 09:00

	it('fires when day bit + time match and not yet fired today', () => {
		expect(dueReminders([r({ days: MON, time: '09:00' })], now)).toHaveLength(1);
	});
	it('skips a different weekday', () => {
		expect(dueReminders([r({ days: TUE | WED, time: '09:00' })], now)).toHaveLength(0);
	});
	it('skips a different minute', () => {
		expect(dueReminders([r({ days: MON, time: '09:01' })], now)).toHaveLength(0);
	});
	it('skips disabled reminders', () => {
		expect(dueReminders([r({ days: MON, time: '09:00', enabled: false })], now)).toHaveLength(0);
	});
	it('does not re-fire the same day (dedupe on lastFired)', () => {
		expect(dueReminders([r({ days: MON, time: '09:00', lastFired: '2026-07-20' })], now)).toHaveLength(0);
	});
	it('fires again after the fired date changes', () => {
		expect(dueReminders([r({ days: MON, time: '09:00', lastFired: '2026-07-13' })], now)).toHaveLength(1);
	});
});
