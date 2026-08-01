import { test, expect, type Page } from '@playwright/test';
import { login, menuNav, TINY_JPEG } from './helpers';

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

	// Create a custom food and log it to Lunch. Use a unique name so it doesn't
	// collide with the seeded food library.
	await page.locator('[data-act="add-food"][data-slot="lunch"]').click();
	await page.getByRole('button', { name: /New food/ }).click();
	await page.locator('[data-act="food-field"][data-field="name"]').fill('ZZ Test Chicken');
	await page.locator('[data-act="food-field"][data-field="kcal"]').fill('200');
	await page.getByRole('button', { name: /Add food/ }).click();
	await page.locator('[data-act="log-food"]', { hasText: 'ZZ Test Chicken' }).click();
	await page.locator('.back-btn').click();
	await expect(page.getByText('ZZ Test Chicken')).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('500');

	// Edit the oatmeal quick-add entry's total kcal 300 -> 600 (600 + 200 = 800).
	await page.getByText('Oatmeal').click();
	await page.locator('[data-act="entry-field"][data-field="kcal"]').fill('600');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.kcal-num')).toHaveText('800');

	// Edit the chicken FOOD entry by grams: 100g -> 150g (200 kcal/100g -> 300).
	await page.getByText('ZZ Test Chicken').click();
	await page.locator('[data-act="entry-grams"]').fill('150');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.kcal-num')).toHaveText('900');

	// Reload: the day's entries come from SQLite.
	await page.reload();
	await expect(page.getByText('Oatmeal')).toBeVisible();
	await expect(page.getByText('ZZ Test Chicken')).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('900');
});

test('nutrition: build a saved meal and log it in one tap', async ({ page }) => {
	await login(page);
	await openNutritionOn(page, '2024-06-02');

	// Need a food in the library first.
	await page.locator('[data-act="add-food"][data-slot="breakfast"]').click();
	await page.getByRole('button', { name: /New food/ }).click();
	await page.locator('[data-act="food-field"][data-field="name"]').fill('ZZ Test Egg');
	await page.locator('[data-act="food-field"][data-field="kcal"]').fill('70');
	await page.getByRole('button', { name: /Add food/ }).click();

	// Build a saved meal of two eggs.
	await page.getByRole('button', { name: 'Meals' }).click();
	await page.getByRole('button', { name: /New meal/ }).click();
	await page.locator('[data-act="meal-name"]').fill('Two eggs');
	await page.getByRole('button', { name: /Add food/ }).click();
	// The shared e2e DB holds the seeded library; pick our unique food, twice.
	const eggPick = page.locator('.meal-chooser [data-act="meal-add-food"]', { hasText: 'ZZ Test Egg' });
	await eggPick.click();
	await eggPick.click();
	await page.getByRole('button', { name: /Create meal/ }).click();

	// Log the meal in one tap; both items land in the day (2 × 70 = 140).
	await page.locator('[data-act="log-meal"]', { hasText: 'Two eggs' }).first().click();
	await page.locator('.back-btn').click();
	await expect(page.getByText('ZZ Test Egg').first()).toBeVisible();
	await expect(page.locator('.kcal-num')).toHaveText('140');
});

test('nutrition per-100g: meal by grams + everyday one-tap add', async ({ page }) => {
	await login(page);
	await openNutritionOn(page, '2024-09-01');

	// A food with 130 kcal per 100 g.
	await page.locator('[data-act="add-food"][data-slot="lunch"]').click();
	await page.getByRole('button', { name: /New food/ }).click();
	await page.locator('[data-act="food-field"][data-field="name"]').fill('ZZ Test Rice');
	await page.locator('[data-act="food-field"][data-field="kcal"]').fill('130');
	await page.getByRole('button', { name: /Add food/ }).click();

	// A meal with 200 g of rice (→ 260 kcal), marked everyday for Lunch.
	await page.getByRole('button', { name: 'Meals' }).click();
	await page.getByRole('button', { name: /New meal/ }).click();
	await page.locator('[data-act="meal-name"]').fill('Rice bowl');
	await page.getByRole('button', { name: /Add food/ }).click();
	await page.locator('.meal-chooser [data-act="meal-add-food"]', { hasText: 'ZZ Test Rice' }).click();
	await page.locator('[data-act="meal-grams"]').fill('200');
	await page.getByRole('button', { name: /Every day/ }).click();
	await page.getByRole('button', { name: 'Lunch' }).click();
	await page.getByRole('button', { name: /Create meal/ }).click();

	// From the day, one tap adds all everyday meals → 200 g × 130/100 = 260 kcal.
	await page.locator('.back-btn').click();
	await page.getByRole('button', { name: /Add daily meals/ }).click();
	await expect(page.locator('.kcal-num')).toHaveText('260');
	await expect(page.getByText('ZZ Test Rice')).toBeVisible();
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

// Synthetic touch drag: the app's gesture code only reads touches[0].clientX/Y,
// so constructed TouchEvents exercise the same path a finger does.
async function swipe(page: Page, selector: string, dx: number) {
	await page.evaluate(
		({ selector, dx }) => {
			const el = document.querySelector(selector) as Element;
			const r = el.getBoundingClientRect();
			const y = r.top + r.height / 2;
			const x0 = r.left + r.width / 2;
			const at = (x: number) =>
				new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
			const fire = (type: string, x: number) =>
				el.dispatchEvent(
					new TouchEvent(type, {
						bubbles: true,
						cancelable: true,
						touches: type === 'touchend' ? [] : [at(x)],
						changedTouches: [at(x)]
					})
				);
			fire('touchstart', x0);
			fire('touchmove', x0 + dx * 0.25);
			fire('touchmove', x0 + dx);
			fire('touchend', x0 + dx);
		},
		{ selector, dx }
	);
}

test('lightbox: swipe and arrow keys move between photos', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Photos');
	await page.getByRole('button', { name: /New album/ }).click();
	await page.locator('[data-act="new-album-text"]').fill('Carousel');
	await page.getByRole('button', { name: 'Add', exact: true }).click();

	await page.locator('[data-act="pick-photo"]').waitFor();
	await page.locator('#photo-file').setInputFiles([
		{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
		{ name: 'b.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG }
	]);
	await page.getByRole('button', { name: /Upload 2 photos/ }).click();
	await expect(page.locator('.pgrid-img')).toHaveCount(2);

	// Open the first photo — the whole album rides in the carousel.
	await page.locator('.pgrid-cell').first().click();
	await expect(page.locator('.lightbox-slide')).toHaveCount(2);
	await expect(page.locator('.lightbox-count')).toHaveText('1 / 2');

	// Swipe left → next photo. The drawer must not steal the horizontal drag.
	await swipe(page, '.lightbox-stage', -160);
	await expect(page.locator('.lightbox-count')).toHaveText('2 / 2');
	await expect(page.locator('#lb-track')).toHaveCSS('transform', /matrix\(1, 0, 0, 1, -\d/);
	await expect(page.locator('.drawer.open')).toHaveCount(0);

	// Past the end it stays put; swiping back returns to the first photo.
	await swipe(page, '.lightbox-stage', -160);
	await expect(page.locator('.lightbox-count')).toHaveText('2 / 2');
	await swipe(page, '.lightbox-stage', 160);
	await expect(page.locator('.lightbox-count')).toHaveText('1 / 2');

	// A short drag snaps back instead of changing photo.
	await swipe(page, '.lightbox-stage', -20);
	await expect(page.locator('.lightbox-count')).toHaveText('1 / 2');

	// Arrow keys do the same on a keyboard.
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.lightbox-count')).toHaveText('2 / 2');
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.lightbox-count')).toHaveText('1 / 2');
});

// Nutrition tests pin a unique day so the shared e2e DB doesn't mix their totals.

test('upload a program with a PDF and view it', async ({ page }) => {
	await login(page);
	await menuNav(page, 'Programs');
	await page.getByRole('button', { name: /Add program/ }).click();

	await page.locator('[data-act="prog-title"]').fill('Knee rehab plan');
	await page.getByRole('button', { name: /Rehab/ }).click();
	await page.locator('[data-act="prog-date"]').fill('2026-07-01');
	await page.locator('[data-act="prog-notes"]').fill('3x per week');
	await page.locator('#program-file').setInputFiles({
		name: 'plan.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'utf8')
	});
	await expect(page.getByText(/PDF attached/)).toBeVisible();
	await page.getByRole('button', { name: 'Add program', exact: true }).click();

	// Listed on the Programs screen; reload proves it persisted to SQLite.
	await expect(page.locator('.tpl-name', { hasText: 'Knee rehab plan' })).toBeVisible();
	await page.reload();
	await expect(page.locator('.tpl-name', { hasText: 'Knee rehab plan' })).toBeVisible();

	// Open it — the in-app PDF host (pdf.js canvas container) + notes render.
	await page.locator('.tpl-card', { hasText: 'Knee rehab plan' }).click();
	await expect(page.locator('.pdf-doc')).toBeVisible();
	await expect(page.getByText('3x per week')).toBeVisible();
});
