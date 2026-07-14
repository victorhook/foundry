import { test, expect, type Page } from '@playwright/test';

const USER = 'e2e';
const PASS = 'e2e-pass';

async function login(page: Page) {
	await page.goto('/login');
	await page.getByPlaceholder('Username').fill(USER);
	await page.getByPlaceholder('Password').fill(PASS);
	await page.getByRole('button', { name: 'Sign in' }).click();
	// Client app mounts + fetches data; the "Add workout" button proves we're home.
	await expect(page.getByRole('button', { name: /Add workout/ })).toBeVisible();
}

// The routine quick-buttons now live behind "Add workout" (the chooser), not on home.
async function startRoutine(page: Page, name: string) {
	await page.getByRole('button', { name: /Add workout/ }).click();
	await page.locator('.routine', { hasText: name }).click();
}

// History / Photos / Templates / Profile / Sign out now live in the hamburger menu.
async function menuNav(page: Page, name: string) {
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('button', { name }).click();
}

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

	// Home shows the saved session in Recent.
	await expect(page.getByText(/1 exercise/)).toBeVisible();

	// Reload: the workout is served from SQLite, not local draft — proves persistence.
	await page.reload();
	await expect(page.getByRole('button', { name: /Add workout/ })).toBeVisible();
	await expect(page.getByText(/1 exercise/)).toBeVisible();
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
	await expect(page.locator('.d-set')).toHaveCount(2);
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

	// Add a new theme within the Theme block and select it.
	const themeBlock = page.locator('.finish-block', { hasText: 'Theme' });
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

test('photos: create album, upload, appears in grid', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Photos');

	await page.getByRole('button', { name: /New album/ }).click();
	await page.locator('[data-act="new-album-text"]').fill('Progress');
	await page.getByRole('button', { name: 'Add', exact: true }).click();

	// Upload a tiny generated JPEG via the hidden file input.
	await page.locator('[data-act="pick-photo"]').waitFor();
	await page.locator('#photo-file').setInputFiles({
		name: 'p.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from(
			'/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAAyADIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
			'base64'
		)
	});
	await page.locator('.sheet-thumb').first().waitFor();
	await page.locator('[data-act="up-tags"]').fill('front');
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.locator('.pgrid-img').first()).toBeVisible();

	// Reload — restores to the album (albumId is persisted); photo served from DB.
	await page.reload();
	await expect(page.locator('.pgrid-img').first()).toBeVisible();
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

	// Back in the editor with the entry; save the template (returns to the chooser).
	await expect(page.getByText('Overhead Press')).toBeVisible();
	await page.getByRole('button', { name: /Create template/ }).click();
	await expect(page.locator('.tpl-name', { hasText: 'Push Day' })).toBeVisible();

	// Reload proves the template persisted to SQLite.
	await page.reload();
	await expect(page.locator('.tpl-name', { hasText: 'Push Day' })).toBeVisible();

	// Start from the template; the session is prefilled (3 sets).
	await page.locator('.tpl-card', { hasText: 'Push Day' }).click();
	await expect(page.getByText('Overhead Press')).toBeVisible();
	await expect(page.locator('.set-row')).toHaveCount(3);
});

test('multiple photos upload in one batch', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Photos');
	await page.getByRole('button', { name: /New album/ }).click();
	await page.locator('[data-act="new-album-text"]').fill('Batch');
	await page.getByRole('button', { name: 'Add', exact: true }).click();

	const jpeg = Buffer.from(
		'/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAAyADIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
		'base64'
	);
	await page.locator('[data-act="pick-photo"]').waitFor();
	await page.locator('#photo-file').setInputFiles([
		{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpeg },
		{ name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpeg }
	]);
	await expect(page.getByRole('button', { name: /Upload 2 photos/ })).toBeVisible();
	await page.getByRole('button', { name: /Upload 2 photos/ }).click();
	await expect(page.locator('.pgrid-img')).toHaveCount(2);
});

// Nutrition tests pin a unique day so the shared e2e DB doesn't mix their totals.
async function openNutritionOn(page: Page, day: string) {
	await menuNav(page, 'Nutrition');
	await page.locator('[data-act="nutri-date"]').fill(day);
}

test('nutrition: targets, quick-add, custom food, edit qty, and persistence', async ({ page }) => {
	await login(page);
	await openNutritionOn(page, '2024-06-01');

	// Set a daily calorie target.
	await page.getByRole('button', { name: /Targets/ }).click();
	await page.locator('[data-act="target-field"][data-field="kcal"]').fill('2000');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.kcal-cap')).toContainText('2000');

	// Quick-add to Breakfast.
	await page.locator('[data-act="add-food"][data-slot="breakfast"]').click();
	await page.getByRole('button', { name: 'Quick add' }).click();
	await page.locator('[data-act="quick-name"]').fill('Oatmeal');
	await page.locator('[data-act="quick-field"][data-field="kcal"]').fill('300');
	await page.getByRole('button', { name: /Add to Breakfast/ }).click();
	await page.locator('.back-btn').click();
	await expect(page.getByText('Oatmeal')).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('300');

	// Create a custom food and log it to Lunch.
	await page.locator('[data-act="add-food"][data-slot="lunch"]').click();
	await page.getByRole('button', { name: /New food/ }).click();
	await page.locator('[data-act="food-field"][data-field="name"]').fill('Chicken breast');
	await page.locator('[data-act="food-field"][data-field="kcal"]').fill('200');
	await page.getByRole('button', { name: /Add food/ }).click();
	await page.locator('[data-act="log-food"]').first().click();
	await page.locator('.back-btn').click();
	await expect(page.getByText('Chicken breast')).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('500');

	// Edit the oatmeal entry: qty 1 -> 2, totals recompute (300*2 + 200).
	await page.getByText('Oatmeal').click();
	await page.locator('[data-act="entry-qty-inc"]').click();
	await page.locator('[data-act="entry-qty-inc"]').click();
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.kcal-num')).toHaveText('800');

	// Reload: the day's entries come from SQLite.
	await page.reload();
	await expect(page.getByText('Oatmeal')).toBeVisible();
	await expect(page.getByText('Chicken breast')).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('800');
});

test('nutrition: build a saved meal and log it in one tap', async ({ page }) => {
	await login(page);
	await openNutritionOn(page, '2024-06-02');

	// Need a food in the library first.
	await page.locator('[data-act="add-food"][data-slot="breakfast"]').click();
	await page.getByRole('button', { name: /New food/ }).click();
	await page.locator('[data-act="food-field"][data-field="name"]').fill('Egg');
	await page.locator('[data-act="food-field"][data-field="kcal"]').fill('70');
	await page.getByRole('button', { name: /Add food/ }).click();

	// Build a saved meal of two eggs.
	await page.getByRole('button', { name: 'Meals' }).click();
	await page.getByRole('button', { name: /New meal/ }).click();
	await page.locator('[data-act="meal-name"]').fill('Two eggs');
	await page.getByRole('button', { name: /Add food/ }).click();
	// The shared e2e DB may hold other foods; pick Egg specifically, twice.
	const eggPick = page.locator('.meal-chooser [data-act="meal-add-food"]', { hasText: 'Egg' });
	await eggPick.click();
	await eggPick.click();
	await page.getByRole('button', { name: /Create meal/ }).click();

	// Log the meal in one tap; both items land in the day (2 × 70 = 140).
	await page.locator('[data-act="log-meal"]').first().click();
	await page.locator('.back-btn').click();
	await expect(page.getByText('Egg').first()).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('140');
});
