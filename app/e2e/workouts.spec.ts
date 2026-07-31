import { test, expect } from '@playwright/test';
import { login, startRoutine, menuNav } from './helpers';

test('unauthenticated visits are redirected to login', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('log a gym workout end-to-end and persist it', async ({ page }) => {
	await login(page);

	// Start a Gym session.
	await startRoutine(page, 'Gym');
	await expect(page.getByRole('button', { name: /Finish workout/ })).toBeVisible();

	// Create a custom exercise and add it to the session.
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Bench Press');
	await page.getByRole('button', { name: 'Chest' }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// Back on the active session, the exercise is listed.
	await expect(page.getByText('Bench Press')).toBeVisible();

	// Finish: rate effort, save.
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: '7', exact: true }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();

	// Home shows the saved session at the top of Recent. Scoped to .first() because
	// this file no longer owns the database: run alongside the other specs, older
	// sessions are also on Home and an unscoped match is ambiguous.
	await expect(page.getByText(/1 exercise/).first()).toBeVisible();

	// Reload: the workout is served from SQLite, not local draft — proves persistence.
	await page.reload();
	await expect(page.getByRole('button', { name: /Add workout/ })).toBeVisible();
	await expect(page.getByText(/1 exercise/).first()).toBeVisible();
});

test('strength sets (weight+reps) persist and carry over', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');

	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Squat');
	await page.getByRole('button', { name: 'Legs' }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// Add two sets — the second copies the first (carry-over).
	await page.getByRole('button', { name: /Add set/ }).click();
	await page.getByRole('button', { name: /Add set/ }).click();
	await expect(page.locator('.set-row')).toHaveCount(2);

	// Edit the exercise name from the active workout.
	await page.locator('.ex-name-edit').click();
	await page.getByPlaceholder('Name').fill('Back Squat');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.ex-name-edit')).toContainText('Back Squat');

	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();

	// Open the saved workout; the two sets are shown.
	await page.getByText(/1 exercise/).first().click();
	await expect(page.getByText('Back Squat')).toBeVisible();
	// Compact detail summarizes the two sets on one line.
	await expect(page.locator('.d-ex', { hasText: 'Back Squat' }).locator('.d-ex-sum')).toContainText('2 sets');
});

test('edit the date of a saved workout', async ({ page }) => {
	await login(page);

	// Save a quick Gym session, then open it from Recent.
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();
	await page.locator('.hcard').first().click();

	// Change its date; the header label + stored value update.
	await expect(page.locator('[data-act="detail-date"]')).toBeVisible();
	await page.locator('[data-act="detail-date"]').fill('2023-01-15');
	await expect(page.locator('.section-head .eyebrow')).toContainText('Jan 15');

	// Reload: the new date is served from SQLite.
	await page.reload();
	await expect(page.locator('[data-act="detail-date"]')).toHaveValue('2023-01-15');
});

test('gym workout theme shows in the summary', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Finish workout/ }).click();

	// Add a new category within the Category block and select it.
	const themeBlock = page.locator('.finish-block', { hasText: 'Category' });
	await themeBlock.getByRole('button', { name: '+ New' }).click();
	await page.locator('[data-act="theme-new-text"]').fill('Shoulders');
	await themeBlock.getByRole('button', { name: 'Add' }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();

	// The Recent card title reflects the theme.
	await expect(page.locator('.h-title', { hasText: 'Shoulders' })).toBeVisible();
});

test('back button returns to where you came from', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();

	// Home → open the workout → Back should land Home (not History).
	await page.locator('.hcard').first().click();
	await expect(page.locator('[data-act="detail-date"]')).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('button', { name: /Add workout/ })).toBeVisible();
});

test('reorder exercises by dragging', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	for (const name of ['Alpha', 'Bravo']) {
		await page.getByRole('button', { name: /Add exercise/ }).click();
		await page.getByRole('button', { name: /New exercise/ }).click();
		await page.getByPlaceholder('Name').fill(name);
		await page.getByRole('button', { name: 'Chest' }).click();
		await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
	}
	// Initial order: Alpha (top), Bravo.
	await expect(page.locator('.ex-card').first()).toContainText('Alpha');

	// Drag Alpha's handle below Bravo.
	const handle = page.locator('.ex-card', { hasText: 'Alpha' }).locator('.drag-handle');
	const hb = await handle.boundingBox();
	const bravo = page.locator('.ex-card', { hasText: 'Bravo' });
	const bb = await bravo.boundingBox();
	await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
	await page.mouse.down();
	await page.mouse.move(hb!.x + hb!.width / 2, bb!.y + bb!.height + 20, { steps: 12 });
	await page.mouse.up();

	// Order is now Bravo, Alpha.
	await expect(page.locator('.ex-card').first()).toContainText('Bravo');
});

test('walk logs time + pace with estimated distance', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Walk');

	// Paced UI: no km field, a distance estimate, and Normal/Fast options.
	await expect(page.locator('.est-dist')).toBeVisible();
	await page.getByRole('button', { name: 'Fast' }).click();
	await expect(page.locator('.est-dist')).toContainText('km');

	// Duration is directly editable (not just +/-): typing updates the estimate.
	await page.locator('.big-val-input').fill('60');
	await expect(page.locator('.est-dist')).toContainText('6.5 km'); // 60 min @ fast (6.5 km/h)

	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();
	await expect(page.locator('.hcard', { hasText: 'Walk' }).first()).toBeVisible();
});

test('finish-screen notes field does not navigate away; workout resumes from home', async ({ page }) => {
	await login(page);
	await startRoutine(page, 'Gym');
	await expect(page.getByRole('button', { name: /Finish workout/ })).toBeVisible();

	// Go to the finish screen and tap the workout-notes field. This used to fire
	// the global "Notes" action and yank you off the workout — regression guard.
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.locator('#notes').click();
	await page.locator('#notes').fill('felt strong');
	// Still on the finish screen (not the daily Notes list).
	await expect(page.getByRole('button', { name: /Save workout/ })).toBeVisible();

	// Back to the active session (has the hamburger), then leave to Home. The
	// in-progress workout is a draft, so Home offers a Resume card.
	await page.locator('.back-btn').first().click();
	await expect(page.getByRole('button', { name: /Finish workout/ })).toBeVisible();
	await menuNav(page, 'Home');
	await expect(page.locator('.resume-card')).toBeVisible();
	await page.locator('[data-act="resume-workout"]').click();
	await expect(page.getByRole('button', { name: /Finish workout/ })).toBeVisible();
});

test('attach a note to a saved workout and it persists', async ({ page }) => {
	await login(page);

	// Save a quick Gym session, then open it from Recent.
	await startRoutine(page, 'Gym');
	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();
	await page.locator('.hcard').first().click();

	// Add a note on the detail screen; it saves via the workouts PUT (debounced).
	const note = page.locator('[data-act="detail-note"]');
	await expect(note).toBeVisible();
	await note.fill('Right shoulder felt tight on presses');
	// Give the debounced save time to fire, then reload — the detail view is
	// restored and the note comes back from SQLite.
	await page.waitForTimeout(900);
	await page.reload();
	await expect(page.locator('[data-act="detail-note"]')).toHaveValue('Right shoulder felt tight on presses');
});

test('templates: build one and start a prefilled workout from it', async ({ page }) => {
	await login(page);

	// Build a template via the Add-workout chooser (Templates live there now).
	await page.getByRole('button', { name: /Add workout/ }).click();
	await page.locator('[data-act="new-template"]').click();
	await page.locator('[data-act="tpl-name"]').fill('Push Day');

	// Add an exercise by creating one from the picker (template starts empty).
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Overhead Press');
	await page.getByRole('button', { name: 'Shoulders' }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// Back in the editor with the entry.
	await expect(page.getByText('Overhead Press')).toBeVisible();

	// Add a second exercise by PICKING the existing one from the library.
	// (Picking now keeps the picker open so several can be added in one trip;
	// tapping shows a ✓ and "Done" returns to the editor.)
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.locator('.ex-pick', { hasText: 'Overhead Press' }).click();
	await expect(page.locator('.ex-pick', { hasText: 'Overhead Press' })).toHaveClass(/added/);
	await page.getByRole('button', { name: /Done/ }).click();
	await expect(page.locator('.ex-card')).toHaveCount(2);

	await page.getByRole('button', { name: /Create template/ }).click();
	await expect(page.locator('.tpl-name', { hasText: 'Push Day' })).toBeVisible();

	// Reload proves the template persisted to SQLite.
	await page.reload();
	await expect(page.locator('.tpl-name', { hasText: 'Push Day' })).toBeVisible();

	// Start from the template; the session is prefilled (3 sets on the open entry).
	await page.locator('.tpl-card', { hasText: 'Push Day' }).click();
	await expect(page.getByText('Overhead Press').first()).toBeVisible();
	await expect(page.locator('.set-row')).toHaveCount(3);
});
