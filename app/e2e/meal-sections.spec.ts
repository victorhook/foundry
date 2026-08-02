import { test, expect, type Page } from '@playwright/test';
import { login, menuNav } from './helpers';

async function openNutritionOn(page: Page, day: string) {
	await menuNav(page, 'Nutrition');
	await page.locator('[data-act="nutri-date"]').fill(day);
}

test('nutrition: custom meal sections — add, rename, reorder, macro summary, delete moves food', async ({
	page
}) => {
	await login(page);
	await openNutritionOn(page, '2024-07-15');

	// The four seeded sections render.
	await expect(page.locator('.slot-title')).toHaveText(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);

	// Open the manager and add a section.
	await page.locator('[data-act="msec-toggle"]').click();
	await page.locator('[data-act="msec-new"]').click();
	await page.locator('[data-act="msec-new-text"]').fill('Preworkout');
	await page.locator('[data-act="msec-new-add"]').click();
	await expect(page.locator('.slot-title')).toHaveText([
		'Breakfast',
		'Lunch',
		'Dinner',
		'Snacks',
		'Preworkout'
	]);

	// Rename "Snacks" -> "Evening".
	await page.locator('[data-act="msec-rename"][data-id="snack"]').click();
	await page.locator('[data-act="msec-text"]').fill('Evening');
	await page.locator('[data-act="msec-save"]').click();
	await expect(page.locator('.slot-title')).toContainText(['Evening']);

	// Reorder: move Preworkout up one (last -> before Evening).
	await page.locator('[data-act="msec-move"][data-id="preworkout"][data-dir="-1"]').click();
	await expect(page.locator('.slot-title')).toHaveText([
		'Breakfast',
		'Lunch',
		'Dinner',
		'Preworkout',
		'Evening'
	]);

	// Close the manager, log a quick-add into Preworkout.
	await page.locator('[data-act="msec-toggle"]').click();
	await page.locator('[data-act="add-food"][data-slot="preworkout"]').click();
	await page.getByRole('button', { name: 'Quick add' }).click();
	await page.locator('[data-act="quick-name"]').fill('Banana');
	await page.locator('[data-act="quick-field"][data-field="kcal"]').fill('250');
	await page.locator('[data-act="quick-field"][data-field="protein"]').fill('30');
	await page.getByRole('button', { name: /Add to Preworkout/ }).click();
	await page.locator('.back-btn').click();

	// The Preworkout section now shows a macro summary.
	const preworkout = page.locator('.nutri-slot', { hasText: 'Preworkout' });
	await expect(preworkout.locator('.slot-macros')).toContainText('P 30');
	await expect(preworkout.locator('.slot-kcal')).toContainText('250 kcal');

	// Delete Preworkout — its logged food moves to the first section (Breakfast).
	await page.locator('[data-act="msec-toggle"]').click();
	await page.locator('[data-act="msec-del"][data-id="preworkout"]').click();
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await expect(page.locator('.slot-title')).toHaveText(['Breakfast', 'Lunch', 'Dinner', 'Evening']);

	// The banana survived — it now lives under Breakfast.
	const breakfast = page.locator('.nutri-slot', { hasText: 'Breakfast' });
	await expect(breakfast).toContainText('Banana');

	// Reload: sections + the reassignment are persisted in SQLite.
	await page.reload();
	await expect(page.locator('.slot-title')).toHaveText(['Breakfast', 'Lunch', 'Dinner', 'Evening']);
	await expect(page.locator('.nutri-slot', { hasText: 'Breakfast' })).toContainText('Banana');
});
