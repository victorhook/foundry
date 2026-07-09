# Foundry — project handoff / session notes

Snapshot of where the project stands, so context survives a directory rename or a
fresh Claude Code session. Living docs: `README.md`, `WORKFLOW.md`, `app/DEPLOY.md`.

## What Foundry is

A personal, single-user workout tracker. Phone-first installable PWA, self-hosted.
Logging is deliberately fast/low-friction (the whole point):

- **Gym** = an exercise *checklist* — no reps/weight/sets (user doesn't want to log numbers).
- **Cardio** (Bike / Run / Walk / Bike Interval) = duration + distance only.
- Per-exercise **pain** (user-defined categories, 1–10) and an optional note.
- On finish: overall **effort** (RPE 1–10), **energy** (1–5), session pain, notes.
- Backdating supported (tap a calendar day, or the date field on finish).
- Home screen has a month **calendar** coloured by that day's effort.

## Stack

- **SvelteKit 2 + Svelte 5** (runes), `adapter-node`.
- **SQLite** via `better-sqlite3` (raw SQL, no ORM). One file = whole DB.
- Auth: Node-crypto scrypt password + HMAC signed session cookie. **Single user**,
  seeded from `ADMIN_USER`/`ADMIN_PASSWORD` on first DB init. **Rolling 30-day**
  session (refreshed every request → never re-login while in active use).
- PWA: `static/manifest.webmanifest`, `static/icon.svg`, `src/service-worker.ts`.
- The UI is a ported single-file prototype living in `src/lib/foundry.ts`
  (imperative, `// @ts-nocheck`, mounted client-only via `+page.svelte`).
  Server is the source of truth via JSON API; localStorage only holds the
  in-progress-session draft.

## Repo / workflow

- Own git repo; remote `git@github.com:victorhook/foundry.git` (branch `main`).
- `make` targets: `setup`, `dev`, `test` (unit+build+e2e), `test-unit`, `test-e2e`,
  `check`, `push` (fast gate then push), `deploy`/`release`.
- Tests: Vitest unit (`src/lib/server/auth.test.ts`) + Playwright e2e
  (`e2e/foundry.spec.ts`). GitHub Actions CI at `.github/workflows/ci.yml`.
- Pre-push git hook runs unit tests + build.

## Data safety (verified working)

- DB file (`/opt/foundry/data/`) is separate from code (`build/`); deploy never
  touches `data/`.
- **Migrations**: `user_version` runner in `src/lib/server/db.ts`. Baseline is
  frozen (v1); to change schema, append a function to the `migrations` array — it
  applies once, automatically, on next start. Safe on existing data.
- **Backups**: `app/deploy/backup.sh` (SQLite online `.backup`, prunes >30 days),
  run nightly by `foundry-backup.timer` AND automatically before every `make deploy`.

## Secrets (audited clean — nothing on GitHub)

- Real secrets live only in `app/.env` (local) and `/opt/foundry/.env` (server).
- `.deploy.env` (local, gitignored) holds the VPS host/user for `make deploy`.
- Full git history verified: no `.env`, DB, keys, or real passwords ever committed.

## NEXT STEP: first deployment (not done yet)

Target VPS + domain are the user's (cloud VPS, own domain, wants proper HTTPS).
`.deploy.env` is filled in with the server IP + SSH user.

To go live, follow `app/DEPLOY.md`:
1. Point a subdomain (A record) at the VPS IP.
2. On the VPS: install `nodejs caddy sqlite3`; create `/opt/foundry`, a `foundry`
   service user, and `/opt/foundry/.env` (real `AUTH_SECRET` via `openssl rand -hex 32`,
   plus `ADMIN_USER`/`ADMIN_PASSWORD`).
3. Install `deploy/foundry.service` + the backup timer; put `deploy/Caddyfile` at
   `/etc/caddy/Caddyfile` (edit the domain) for auto-HTTPS. Open ports 80/443.
4. From the laptop: `make deploy`.
5. On phone: open the HTTPS URL → Add to Home Screen.

The passwordless-sudo line for the deploy user (to allow the restart):
`<user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart foundry`

## Re-saving this session

The raw transcript is copied to `.session-archive/` (gitignored). It's a
point-in-time snapshot; to refresh it later:

```bash
cp ~/.claude/projects/-home-victor-projects-foundry/*.jsonl .session-archive/   # path reflects the renamed dir
```
