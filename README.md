# Logbook

A personal workout tracker — phone-first PWA, self-hosted. Log gym sessions
(exercise checklist), cardio (bike/run/walk), how it felt (effort, energy),
and any pain, with a calendar of past sessions.

The app lives in **`app/`** — SvelteKit + SQLite, single-user auth, installable PWA.

## Quick start

```bash
make setup     # install deps, enable git hooks
make dev       # run locally
make test      # unit + build + e2e
```

See **[WORKFLOW.md](WORKFLOW.md)** for the dev/test/release loop and
**[app/DEPLOY.md](app/DEPLOY.md)** for deploying to a VPS.
