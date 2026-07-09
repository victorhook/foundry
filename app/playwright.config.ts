import { defineConfig, devices } from '@playwright/test';

const PORT = 4319;

// e2e runs against a real dev server backed by a throwaway SQLite DB. The
// server env is authoritative (dotenv does not override existing process.env),
// so the seeded login is deterministic here and in CI (no .env needed).
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `rm -rf .e2e-data && npm run dev -- --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			DATABASE_PATH: '.e2e-data/foundry.db',
			AUTH_SECRET: 'e2e-secret',
			ADMIN_USER: 'e2e',
			ADMIN_PASSWORD: 'e2e-pass'
		}
	}
});
