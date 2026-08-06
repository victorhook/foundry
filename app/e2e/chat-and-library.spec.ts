import { test, expect, type Page } from '@playwright/test';
import { login, startRoutine, menuNav, TINY_JPEG } from './helpers';

test('AI chat: create, persist and delete a chat', async ({ page }) => {
	await login(page);
	await menuNav(page, 'AI chat');
	await expect(page.locator('.empty')).toContainText('No chats yet');

	// New chat lands on the transcript view with an empty composer.
	await page.locator('[data-act="new-chat"]').click();
	await expect(page.locator('.chat-input')).toBeVisible();
	await expect(page.locator('.chat-send')).toBeVisible();
	await expect(page.locator('.empty')).toContainText('Ask anything');

	// The draft survives typing without the view re-rendering under the cursor.
	await page.locator('.chat-input').fill('How is my bench progressing?');
	await expect(page.locator('.chat-input')).toHaveValue('How is my bench progressing?');

	// Back to the list: the chat is there, saved server-side. It has no messages
	// yet, so it reads as "Untitled chat" rather than echoing the button label.
	await page.locator('.back-btn').click();
	await expect(page.locator('.note-card')).toHaveCount(1);
	await expect(page.locator('.note-card')).toContainText('Untitled chat');
	await page.reload();
	await expect(page.locator('[data-act="new-chat"]')).toBeVisible();
	await expect(page.locator('.note-card')).toHaveCount(1);

	// Delete it (confirmation modal) → back to the empty state, and it stays gone.
	await page.locator('.note-card').first().click();
	await page.locator('[data-act="del-chat"]').click();
	await page.locator('[data-act="confirm-ok"]').click();
	await expect(page.locator('.empty')).toContainText('No chats yet');
	await page.reload();
	await expect(page.locator('.empty')).toContainText('No chats yet');
});

// The soft keyboard must never cover the chat composer. Two models to survive:
// the app's viewport meta is interactive-widget=overlays-content, so the browser
// may not resize anything (VisualViewport delta reads 0) and the keyboard height
// comes from the VirtualKeyboard API instead. Real hardware can't be scripted, so
// simulate both and assert the input stays inside the visible band.

const KB = 320; // a typical Android keyboard

async function installKeyboardSim(page: Page) {
	await page.addInitScript(() => {
		(window as any).__kbVp = 0; // height the VisualViewport pretends to lose
		(window as any).__kbVk = 0; // height the VirtualKeyboard API reports
		const vp = window.visualViewport!;
		const realHeight = vp.height;
		Object.defineProperty(vp, 'height', {
			configurable: true,
			get: () => realHeight - (window as any).__kbVp
		});
		const listeners: Array<() => void> = [];
		Object.defineProperty(navigator, 'virtualKeyboard', {
			configurable: true,
			value: {
				overlaysContent: false,
				get boundingRect() {
					return { height: (window as any).__kbVk };
				},
				addEventListener: (_: string, fn: () => void) => listeners.push(fn),
				__fire: () => listeners.forEach((fn) => fn())
			}
		});
	});
}

/** Raise the simulated keyboard via one of the two mechanisms. */

async function raiseKeyboard(page: Page, via: 'visualViewport' | 'virtualKeyboard') {
	await page.evaluate(
		({ via, kb }) => {
			if (via === 'visualViewport') {
				(window as any).__kbVp = kb;
				window.visualViewport!.dispatchEvent(new Event('resize'));
			} else {
				(window as any).__kbVk = kb;
				(navigator as any).virtualKeyboard.__fire();
			}
		},
		{ via, kb: KB }
	);
	// Let the layout settle after the custom property changes.
	await page.waitForTimeout(120);
}

for (const via of ['visualViewport', 'virtualKeyboard'] as const) {
	test(`AI chat: composer stays above the keyboard (${via})`, async ({ page }) => {
		await installKeyboardSim(page);
		await login(page);
		await menuNav(page, 'AI chat');
		await page.locator('[data-act="new-chat"]').click();

		const input = page.locator('.chat-input');
		await expect(input).toBeVisible();
		await input.click();
		await input.fill('Summarize this week');
		await raiseKeyboard(page, via);

		const viewportH = await page.evaluate(() => window.innerHeight);
		const box = await input.boundingBox();
		expect(box).not.toBeNull();
		// The keyboard occupies the bottom KB pixels; the input must sit above it.
		expect(
			box!.y + box!.height,
			`input bottom (${box!.y + box!.height}) must clear the keyboard line (${viewportH - KB})`
		).toBeLessThanOrEqual(viewportH - KB + 2);
		// And still be on screen, not pushed off the top.
		expect(box!.y).toBeGreaterThan(0);
		// The text is still there to read while typing.
		await expect(input).toHaveValue('Summarize this week');
	});
}

test('weekly goal tracks progress on home; generic goal toggles done', async ({ page }) => {
	await login(page);

	// Create a weekly goal filtered to Bike Interval — a type no other test logs,
	// so the count on the shared e2e DB is deterministic (starts at 0).
	await menuNav(page, 'Goals');
	await page.getByRole('button', { name: /New goal/ }).click();
	await page.locator('[data-act="goal-title"]').fill('Intervals 3× this week');
	await page.locator('[data-act="goal-target"]').fill('3');
	await page.locator('[data-act="goal-filter"][data-filter="bikeint"]').click();
	await page.getByRole('button', { name: /Add goal/ }).click();
	await expect(page.locator('.goal-count')).toHaveText('0/3');

	// Back home: the "This week" bar is shown, still 0/3.
	await page.locator('.back-btn').click();
	await expect(page.locator('.goal-card', { hasText: 'Intervals 3×' })).toBeVisible();
	await expect(page.locator('.goal-count')).toHaveText('0/3');

	// Log a Bike Interval workout → progress ticks to 1/3.
	await startRoutine(page, 'Bike Interval');
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();
	await expect(page.locator('.goal-count')).toHaveText('1/3');

	// Progress persists across reload (goal from SQLite, count recomputed).
	await page.reload();
	await expect(page.locator('.goal-count')).toHaveText('1/3');

	// Add a generic goal and check it off.
	await menuNav(page, 'Goals');
	await page.getByRole('button', { name: /New goal/ }).click();
	await page.locator('[data-act="goal-kind"][data-kind="generic"]').click();
	await page.locator('[data-act="goal-title"]').fill('Bench press 100 kg');
	await page.getByRole('button', { name: /Add goal/ }).click();
	await page.locator('.goal-row', { hasText: 'Bench press' }).locator('[data-act="toggle-goal-done"]').click();
	await expect(page.locator('.goal-row', { hasText: 'Bench press' })).toHaveClass(/done/);
	// Reload restores the Goals view; the done state came from SQLite.
	await page.reload();
	await expect(page.locator('.goal-row', { hasText: 'Bench press' })).toHaveClass(/done/);
});

// AI chat: the page, the chat lifecycle, and persistence. Deliberately does NOT
// send a message — that would spawn the real `claude` CLI and spend API credits
// on every test run. The CLI bridge itself is covered by claude.test.ts.

test('notes: add a date-bound note and it persists', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Notes');
	await page.getByRole('button', { name: /Add note/ }).click();
	await page.locator('[data-act="note-date"]').fill('2024-05-20');
	await page.locator('[data-act="note-text"]').fill('Felt strong, knee stable');
	await page.getByRole('button', { name: 'Add note', exact: true }).click();

	await expect(page.locator('.note-text', { hasText: 'Felt strong' })).toBeVisible();
	await page.reload();
	await expect(page.locator('.note-text', { hasText: 'Felt strong' })).toBeVisible();
});

test('profile: weigh-in persists across reload, history folds', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Profile');

	await page.locator('[data-act="weigh-weight"]').fill('80.5');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	// Weight leads the screen; the chart shows but the row-by-row list is folded.
	await expect(page.locator('.detail-stat-row').first()).toContainText('80.5');
	await expect(page.locator('#wchart')).toBeVisible();
	await expect(page.locator('.wrow-val', { hasText: '80.5 kg' })).toHaveCount(0);

	await page.locator('[data-act="fold-weight"]').click();
	await expect(page.locator('.wrow-val', { hasText: '80.5 kg' })).toBeVisible();

	// Reload — the app restores to Profile, the weigh-in comes from the DB, and the
	// fold stays open (it rides along in the local draft).
	await page.reload();
	await expect(page.locator('.wrow-val', { hasText: '80.5 kg' })).toBeVisible();
});

// The ranged digest: what gets handed to an AI agent. The range is the part
// worth guarding — a summary that quietly includes older sessions is worse than
// no summary, because every total in it reads as "this week".
test('profile: export digest covers the chosen range only', async ({ page }) => {
	await login(page);
	const api = page.request;
	const at = (daysBack: number) => {
		const d = new Date();
		d.setDate(d.getDate() - daysBack);
		d.setHours(18, 12, 0, 0);
		return d.getTime();
	};
	const ex = await (await api.post('/api/exercises', {
		data: { name: 'Digest Press', muscles: ['Chest'], equipment: ['barbell'] }
	})).json();
	await api.post('/api/workouts', {
		data: {
			startedAt: at(2), routineName: 'Gym', theme: 'Chest', feel: 7, energy: 4, notes: 'recent one',
			pains: [{ cat: 'Shoulders', level: 3 }],
			entries: [{ exerciseId: ex.id, equipment: 'barbell', sets: [{ reps: 8, weight: 60 }, { reps: 6, weight: 65 }] }]
		}
	});
	await api.post('/api/workouts', {
		data: {
			startedAt: at(40), routineName: 'Gym', feel: 9, energy: 9, notes: 'ancient one', pains: [],
			entries: [{ exerciseId: ex.id, sets: [{ reps: 5, weight: 100 }] }]
		}
	});

	const week = await api.get('/api/export?weeks=1');
	expect(week.ok()).toBeTruthy();
	expect(week.headers()['content-type']).toContain('text/plain');
	const text = await week.text();
	expect(text.split('\n')[0]).toBe('FOUNDRY-DIGEST v1');
	expect(text).toContain('recent one');
	expect(text).not.toContain('ancient one');
	expect(text).toContain('8x60,6x65');
	expect(text).toContain('Shoulders:3');

	// Widen the window and the older session appears too. Other specs in this file
	// share the database, so assert on these two sessions, not on global totals.
	const quarter = await (await api.get('/api/export?weeks=12')).text();
	expect(quarter).toContain('ancient one');
	const json = await (await api.get('/api/export?weeks=12&format=json')).json();
	const recent = json.workouts.find((w: any) => w.notes === 'recent one');
	const ancient = json.workouts.find((w: any) => w.notes === 'ancient one');
	expect(recent.volumeKg).toBe(870); // 8x60 + 6x65
	expect(ancient.volumeKg).toBe(500); // 5x100
	expect(json.summary.sessions).toBeGreaterThanOrEqual(2);

	// A malformed window is refused rather than silently reinterpreted.
	expect((await api.get('/api/export?from=last-tuesday')).status()).toBe(400);

	// The Profile screen offers it: pick a range, and the links carry it.
	await menuNav(page, 'Profile');
	await page.locator('[data-act="export-range"][data-id="12w"]').click();
	await expect(page.locator('a[download]').first()).toHaveAttribute('href', '/api/export?weeks=12');
});

// Steps need a live Google Fit account, so the synced data is injected at the
// /api/data boundary — enough to prove the chart and the fold are wired up.
test('profile: steps chart and foldable daily history', async ({ page }) => {
	const dayKey = (back: number) => {
		const d = new Date();
		d.setDate(d.getDate() - back);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	};
	const steps = [9120, 4380, 12480, 7650, 15230, 3110, 8940].map((s, i) => ({
		day: dayKey(6 - i),
		steps: s
	}));
	await page.route('**/api/data', async (route) => {
		const res = await route.fetch();
		await route.fulfill({ json: { ...(await res.json()), fitConnected: true, steps } });
	});
	// boot()'s auto-sync would otherwise hit Google with no credentials.
	await page.route('**/api/fit', (route) => route.fulfill({ json: { steps } }));

	await login(page);
	await menuNav(page, 'Profile');
	await expect(page.locator('#schart')).toBeVisible();
	// Stat rows in order: weight, steps, about-you.
	await expect(page.locator('.detail-stat-row').nth(1)).toContainText('15,230'); // best of the week

	await expect(page.locator('.wrow-val', { hasText: '12,480' })).toHaveCount(0);
	await page.locator('[data-act="fold-steps"]').click();
	await expect(page.locator('.wrow-val', { hasText: '12,480' })).toBeVisible();
});

test('tap an exercise in the summary opens its info, and Edit works', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Deadlift');
	await page.getByRole('button', { name: 'Legs' }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
	await page.getByRole('button', { name: /Add set/ }).click();
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();

	// Open the workout, then tap the exercise → info screen.
	await page.locator('.hcard').first().click();
	await page.locator('.d-ex', { hasText: 'Deadlift' }).click();
	await expect(page.locator('.exinfo-name', { hasText: 'Deadlift' })).toBeVisible();

	// Edit from the info screen; the change reflects back.
	await page.getByRole('button', { name: /Edit/ }).click();
	await expect(page.getByPlaceholder('Name')).toHaveValue('Deadlift');
	await page.getByPlaceholder('Name').fill('Deadlift (trap bar)');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.exinfo-name', { hasText: 'trap bar' })).toBeVisible();
});

test('exercise image uploads and shows in the picker', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Cable Row');
	await page.getByRole('button', { name: 'Chest' }).click();

	// Attach an image; a preview appears, then save.
	await page.locator('#ex-img-file').setInputFiles({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
	await expect(page.locator('.ex-img-preview')).toBeVisible();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// Reopen the picker — the exercise now shows an image thumbnail.
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await expect(
		page.locator('.ex-pick', { hasText: 'Cable Row' }).locator('img.p-thumb')
	).toBeVisible();
});

// The picker is ordered by recency, and "just added to the library" counts as
// recent — otherwise a brand-new movement sinks into the never-trained tail.
test('a newly added exercise is first in the picker', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	// A name that sorts last alphabetically, so position can only come from recency.
	await page.getByPlaceholder('Name').fill('Zercher Squat');
	await page.getByRole('button', { name: 'Legs' }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	await page.getByRole('button', { name: /Add exercise/ }).click();
	await expect(page.locator('.ex-pick').first()).toContainText('Zercher Squat');
});

// Variants: one library entry per movement, with the equipment (and whether it
// was worked one side at a time) chosen on the entry when logging.
test('an exercise logs which version was used, and a goal tracks that version', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');

	// A movement that can be done with dumbbells or a barbell, one side at a time.
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Shoulder Press');
	await page.locator('[data-act="toggle-equip"][data-q="dumbbell"]').click();
	await page.locator('[data-act="toggle-equip"][data-q="barbell"]').click();
	await page.locator('[data-act="toggle-unilateral"]').click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// The entry offers both versions; log this session as one-armed dumbbells.
	await page.locator('[data-act="entry-equip"][data-q="dumbbell"]').click();
	await page.locator('[data-act="entry-side"]').click();
	await page.getByRole('button', { name: /Add set/ }).click();   // defaults to 8 × 20 kg
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();

	// The saved session records the version, not just the movement.
	await page.locator('.hcard').first().click();
	await expect(page.locator('.d-ex', { hasText: 'Shoulder Press' }).locator('.d-ex-var'))
		.toHaveText('Dumbbell · /side');
	await page.locator('.back-btn').click();   // detail has no menu; pop back home

	// A goal on the dumbbell version counts that 20 kg set…
	await menuNav(page, 'Goals');
	await page.getByRole('button', { name: /New goal/ }).click();
	await page.locator('[data-act="goal-kind"][data-kind="exercise"]').click();
	await page.locator('[data-act="goal-title"]').fill('Press DB');
	await page.locator('[data-act="goal-exercise"]').selectOption({ label: 'Shoulder Press' });
	await page.locator('[data-act="goal-target-value"]').fill('40');
	await page.locator('[data-act="goal-equip"][data-q="dumbbell"]').click();
	await page.getByRole('button', { name: /Add goal/ }).click();
	await expect(page.locator('.goal-card', { hasText: 'Press DB' }).locator('.goal-count'))
		.toHaveText('20/40 kg');

	// …while the same target on the barbell version is untouched by it.
	await page.getByRole('button', { name: /New goal/ }).click();
	await page.locator('[data-act="goal-kind"][data-kind="exercise"]').click();
	await page.locator('[data-act="goal-title"]').fill('Press BB');
	await page.locator('[data-act="goal-exercise"]').selectOption({ label: 'Shoulder Press' });
	await page.locator('[data-act="goal-target-value"]').fill('40');
	await page.locator('[data-act="goal-equip"][data-q="barbell"]').click();
	await page.getByRole('button', { name: /Add goal/ }).click();
	await expect(page.locator('.goal-card', { hasText: 'Press BB' }).locator('.goal-count'))
		.toHaveText('0/40 kg');

	// Both come back from SQLite with progress recomputed from the log.
	await page.reload();
	await expect(page.locator('.goal-card', { hasText: 'Press DB' }).locator('.goal-count'))
		.toHaveText('20/40 kg');
});

// The Exercises register: the whole library outside a workout — create, search
// and edit without having to start a session first.
test('the exercise register creates, filters and edits exercises', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Exercises');

	// Create straight from the register (no workout in progress).
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Pendlay Row');
	await page.getByRole('button', { name: 'Core', exact: true }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row' })).toBeVisible();
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row' })).toContainText('Never done');

	// A second one, so the tag filter has something to exclude.
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Calf Raise');
	await page.getByRole('button', { name: 'Legs', exact: true }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// Search narrows to the one match…
	await page.locator('#reg-q').fill('pendlay');
	await expect(page.locator('.ex-pick')).toHaveCount(1);
	await expect(page.locator('.ex-pick').first()).toContainText('Pendlay Row');

	// …and so does the tag filter (other specs in this file share the DB, so
	// assert on membership rather than exact counts).
	await page.locator('#reg-q').fill('');
	await page.locator('.cat-row').getByRole('button', { name: 'Core', exact: true }).click();
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row' })).toBeVisible();
	await page.locator('.cat-row').getByRole('button', { name: 'Legs', exact: true }).click();
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row' })).toHaveCount(0);
	await page.locator('.cat-row').getByRole('button', { name: 'All', exact: true }).click();

	// Tapping a row edits it; saving pops back to the register with the new name.
	await page.locator('.ex-pick', { hasText: 'Pendlay Row' }).click();
	await expect(page.getByPlaceholder('Name')).toHaveValue('Pendlay Row');
	await page.getByPlaceholder('Name').fill('Pendlay Row (barbell)');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row (barbell)' })).toBeVisible();

	// It really persisted, and a reload lands back on the register (not home).
	await page.reload();
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row (barbell)' })).toBeVisible();

	// Delete removes it from the library for good. Never-logged exercises say so
	// in the confirm, so a harmless delete doesn't read like a scary one.
	await page.locator('.ex-pick', { hasText: 'Calf Raise' }).click();
	await page.locator('[data-act="del-ex-lib"]').click();
	await expect(page.locator('.modal-title')).toHaveText('Delete Calf Raise?');
	await expect(page.locator('.modal-body')).toContainText('Never logged');
	await page.locator('[data-act="confirm-ok"]').click();
	await expect(page.locator('.ex-pick', { hasText: 'Calf Raise' })).toHaveCount(0);
	await page.reload();
	await expect(page.locator('.ex-pick', { hasText: 'Calf Raise' })).toHaveCount(0);
	await expect(page.locator('.ex-pick', { hasText: 'Pendlay Row (barbell)' })).toBeVisible();
});
