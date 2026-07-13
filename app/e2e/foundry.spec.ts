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

	// Menu → Templates → New template.
	await menuNav(page, 'Templates');
	await page.getByRole('button', { name: /New template/ }).click();
	await page.locator('[data-act="tpl-name"]').fill('Push Day');

	// Add an exercise by creating one from the picker (template starts empty).
	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /New exercise/ }).click();
	await page.getByPlaceholder('Name').fill('Overhead Press');
	await page.getByRole('button', { name: 'Shoulders' }).click();
	await page.getByRole('button', { name: 'Add exercise', exact: true }).click();

	// Back in the editor with the entry; save the template.
	await expect(page.getByText('Overhead Press')).toBeVisible();
	await page.getByRole('button', { name: /Create template/ }).click();
	await expect(page.locator('.tpl-name', { hasText: 'Push Day' })).toBeVisible();

	// Reload on the manager proves the template persisted to SQLite.
	await page.reload();
	await expect(page.locator('.tpl-name', { hasText: 'Push Day' })).toBeVisible();

	// Home → Add workout → start from the template; session is prefilled (3 sets).
	await page.getByRole('button', { name: /Home/ }).click();
	await page.getByRole('button', { name: /Add workout/ }).click();
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
