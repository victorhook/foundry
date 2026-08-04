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

test('profile: weigh-in persists across reload', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Profile');

	await page.locator('[data-act="weigh-weight"]').fill('80.5');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('80.5 kg')).toBeVisible();

	// Reload — the app restores to Profile and the weigh-in comes from the DB.
	await page.reload();
	await expect(page.getByText('80.5 kg')).toBeVisible();
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
