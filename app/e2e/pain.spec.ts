import { test, expect } from '@playwright/test';
import { login, menuNav } from './helpers';

// The body-area name is stored on every logged occurrence rather than referenced
// by id, so a rename has to rewrite history server-side. Reloading between the
// rename and the assertions is the point of this test: it proves the change
// reached SQLite instead of only the in-memory copy.
test('renaming a body area rewrites the pain history; removing one drops it from the list', async ({
	page
}) => {
	await login(page);
	await menuNav(page, 'Pain');

	// Log a note under a freshly typed (misspelled) area.
	await page.getByRole('button', { name: /Log pain/ }).click();
	await page.getByRole('button', { name: '+ New' }).click();
	await page.getByPlaceholder('New area…').fill('Lft shin');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await page.getByRole('button', { name: /Save pain note/ }).click();
	await expect(page.locator('.pain-chip', { hasText: 'Lft shin' })).toBeVisible();

	// Fix the typo from the area manager.
	await page.getByRole('button', { name: /Manage/ }).click();
	await page.locator('.area-row', { hasText: 'Lft shin' }).getByRole('button', { name: 'Rename' }).click();
	await page.locator('.area-input').fill('Left shin');
	await page.getByRole('button', { name: 'Save', exact: true }).click();

	// A reload lands back on the Pain screen (the view is persisted).
	await page.reload();
	await expect(page.getByRole('button', { name: /Log pain/ })).toBeVisible();
	// The already-logged note carries the new name, and the old one is gone.
	await expect(page.locator('.pain-chip', { hasText: 'Left shin' })).toBeVisible();
	await expect(page.getByText('Lft shin')).toHaveCount(0);

	// The area itself is renamed too, and knows it's in use.
	await page.getByRole('button', { name: /Manage/ }).click();
	await expect(page.locator('.area-row', { hasText: 'Left shin' })).toContainText('1 logged');

	// Removing it takes it off the pickable list; the logged note keeps the label.
	await page.locator('.area-row', { hasText: 'Left shin' }).getByRole('button', { name: 'Remove area' }).click();
	await page.getByRole('button', { name: 'Remove', exact: true }).click();
	await expect(page.locator('.area-row', { hasText: 'Left shin' })).toHaveCount(0);

	await page.reload();
	await expect(page.locator('.pain-chip', { hasText: 'Left shin' })).toBeVisible();
	await page.getByRole('button', { name: /Log pain/ }).click();
	await expect(page.locator('.chip-row').getByRole('button', { name: 'Left shin' })).toHaveCount(0);
});
