import { expect, type Page } from '@playwright/test';

// Shared across the e2e specs. The suite is split into several files so CI can
// run them as parallel shards; each file must therefore stand on its own against
// a fresh database, because a shard gets its own server and its own SQLite file.

const USER = 'e2e';
const PASS = 'e2e-pass';

export async function login(page: Page) {
	await page.goto('/login');
	await page.getByPlaceholder('Username').fill(USER);
	await page.getByPlaceholder('Password').fill(PASS);
	await page.getByRole('button', { name: 'Sign in' }).click();
	// Client app mounts + fetches data; the "Add workout" button proves we're home.
	await expect(page.getByRole('button', { name: /Add workout/ })).toBeVisible();
}

// The routine quick-buttons now live behind "Add workout" (the chooser), not on home.

export async function startRoutine(page: Page, name: string) {
	await page.getByRole('button', { name: /Add workout/ }).click();
	await page.locator('.routine', { hasText: name }).click();
}

// History / Photos / Templates / Profile / Sign out now live in the hamburger menu.

export async function menuNav(page: Page, name: string) {
	await page.getByRole('button', { name: 'Menu' }).click();
	// Scope to the drawer so in-page links with similar names (e.g. the home
	// "Goals ›" link) don't collide with the drawer item.
	await page.locator('.drawer-panel').getByRole('button', { name }).click();
}

export const TINY_JPEG = Buffer.from(
	'/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAAyADIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
	'base64'
);
