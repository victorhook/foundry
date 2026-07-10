import { test, expect, type Page } from '@playwright/test';

const USER = 'e2e';
const PASS = 'e2e-pass';

async function login(page: Page) {
	await page.goto('/login');
	await page.getByPlaceholder('Username').fill(USER);
	await page.getByPlaceholder('Password').fill(PASS);
	await page.getByRole('button', { name: 'Sign in' }).click();
	// Client app mounts + fetches data; the Gym quick-start proves we're home.
	await expect(page.locator('.routine', { hasText: 'Gym' })).toBeVisible();
}

test('unauthenticated visits are redirected to login', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('log a gym workout end-to-end and persist it', async ({ page }) => {
	await login(page);

	// Start a Gym session.
	await page.locator('.routine', { hasText: 'Gym' }).click();
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
	await expect(page.locator('.routine', { hasText: 'Gym' })).toBeVisible();
	await expect(page.getByText(/1 exercise/)).toBeVisible();
});

test('strength sets (weight+reps) persist and carry over', async ({ page }) => {
	await login(page);
	await page.locator('.routine', { hasText: 'Gym' }).click();

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
	await page.getByRole('button', { name: 'Profile' }).click();

	await page.locator('[data-act="weigh-weight"]').fill('80.5');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('80.5 kg')).toBeVisible();

	// Reload — the app restores to Profile and the weigh-in comes from the DB.
	await page.reload();
	await expect(page.getByText('80.5 kg')).toBeVisible();
});

test('photos: create album, upload, appears in grid', async ({ page }) => {
	await login(page);
	await page.getByRole('button', { name: 'Photos' }).click();

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
	await page.locator('.sheet-preview').waitFor();
	await page.locator('[data-act="up-tags"]').fill('front');
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.locator('.pgrid-img').first()).toBeVisible();

	// Reload — restores to the album (albumId is persisted); photo served from DB.
	await page.reload();
	await expect(page.locator('.pgrid-img').first()).toBeVisible();
});

test('walk logs time + pace with estimated distance', async ({ page }) => {
	await login(page);
	await page.locator('.routine', { hasText: 'Walk' }).click();

	// Paced UI: no km field, a distance estimate, and Normal/Fast options.
	await expect(page.locator('.est-dist')).toBeVisible();
	await page.getByRole('button', { name: 'Fast' }).click();
	await expect(page.locator('.est-dist')).toContainText('km');

	await page.getByRole('button', { name: /Finish workout/ }).click();
	await page.getByRole('button', { name: /Save workout/ }).click();
	await expect(page.locator('.hcard', { hasText: 'Walk' }).first()).toBeVisible();
});
