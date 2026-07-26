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
		// Bind Vite to IPv4 127.0.0.1 explicitly and poll that exact URL. Without
		// --host, Vite binds "localhost" which resolves to IPv6 (::1) on CI runners
		// while tests hit 127.0.0.1 → ERR_CONNECTION_REFUSED.
		command: `rm -rf .e2e-data && npm run dev -- --port ${PORT} --strictPort --host 127.0.0.1`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			DATABASE_PATH: '.e2e-data/foundry.db',
			AUTH_SECRET: 'e2e-secret',
			ADMIN_USER: 'e2e',
			ADMIN_PASSWORD: 'e2e-pass',
			// The AI chat page renders differently depending on whether the `claude`
			// CLI exists on the machine, which would make the test pass on a dev box
			// and fail on CI. Point it at a binary that is always present so the
			// "installed" UI is what gets tested; node is never used as a CLI here
			// because no e2e test sends a message (that would spawn the real agent).
			CLAUDE_BIN: process.execPath,
			AI_WORKSPACE: '.e2e-data/ai-workspace'
		}
	}
});
