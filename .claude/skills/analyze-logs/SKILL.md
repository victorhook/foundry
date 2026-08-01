---
name: analyze-logs
description: >
  Fetch and diagnose the Foundry production server's logs (systemd journal for
  foundry.service). Use when the user reports a prod problem ("can't save", "app
  is erroring", "it's down", "deploy issue") or asks to check the server logs.
  Pulls recent logs (via the token-gated /api/logs endpoint, or a pasted dump),
  then matches them against known failure signatures and reports cause + fix.
---

# Analyze Foundry prod logs

Foundry runs as `foundry.service` (systemd, adapter-node) on a remote VPS behind
a reverse proxy. This machine has **no SSH access** to it, so get the logs one of
these ways, in order of preference.

## 1. Get the logs

**A. Via the API (preferred — no SSH):** the app exposes read-only
`GET /api/logs` (added for exactly this), gated by `API_TOKEN`. Needs the host +
token, which the user provides (ask them to `!export` them into the session, or
paste them):

```bash
curl -s -H "Authorization: Bearer $FOUNDRY_TOKEN" \
  "$FOUNDRY_URL/api/logs?lines=400" | jq -r '.lines[]? // .'
# errors only:
curl -s -H "Authorization: Bearer $FOUNDRY_TOKEN" \
  "$FOUNDRY_URL/api/logs?lines=400&priority=err" | jq -r '.lines[]? // .'
```

If it returns `{"ok":false,"hint":...}`, the service user can't read the journal
yet — relay the hint: `sudo usermod -aG systemd-journal <user> && sudo systemctl
restart foundry` (one time). Fall back to B.

**B. Have the user paste it.** Ask them to run and paste:
```bash
sudo journalctl -u foundry -n 400 --no-pager
```

Always grab enough history to see restarts around the time of the reported
problem. If a specific failure time is known, ask for `--since "HH:MM"`.

## 2. Diagnose — match against these signatures

Scan for these first; each line is `signature → meaning → fix`.

- `State 'stop-sigterm' timed out. Killing.` / `SIGKILL` / `Main process exited,
  code=killed` → the process won't exit on SIGTERM, so **every restart hangs ~90s
  = downtime where all writes fail**. Cause: an un-`unref()`'d `setInterval`/timer
  or an open keep-alive handle (e.g. the reminder scheduler, or an SSE stream)
  keeping the event loop alive. Fix: `.unref()` the timer (see
  `src/lib/server/scheduler.ts`). **This is the usual cause of intermittent
  "can't save X" reports** — the request landed during a restart window.
- `Started foundry.service` repeating every few seconds + a stack trace just
  before each → **crash loop**. Read the stack: a thrown error at import time
  (e.g. `migrate()` in `src/lib/server/db.ts`, or a missing dependency like
  `Cannot find module 'web-push'` after a bad `npm ci`) takes the whole server
  down → every request 5xx/refused.
- `[413] ... Content-length of N exceeds limit of 524288` → adapter-node's
  `BODY_SIZE_LIMIT` (default 512K) rejects the body before the route runs
  (uploads/PDFs). Fix: set `BODY_SIZE_LIMIT` in `/opt/foundry/.env` (the running
  unit loads it) or reinstall `deploy/foundry.service`, then restart.
- `EADDRINUSE :3000` → an old process still holds the port (usually a symptom of
  the SIGTERM-hang above; fixing that fixes this).
- `[500] <METHOD> <path>` + stack → an app error on that endpoint. Read the stack;
  map the chunk back to the route/`$lib/server` module.
- `SQLITE_BUSY` / `database is locked` / `SQLITE_READONLY` / `disk I/O error`
  / `attempt to write a readonly database` → DB lock, wrong file permissions, or
  a full disk. Check `df -h` and the DB file owner vs the service `User=`.
- `no such column` / `no such table` → schema/migration mismatch (a migration
  didn't run, or the array order drifted). Check `PRAGMA user_version`.
- `[fit] sync failed: invalid_grant / Token has been expired or revoked` →
  Google Fit token expired. **Benign** — user reconnects at Profile → Steps.
- `[405] POST /` / `[415] POST /login` / random scanner paths → external junk
  (bots, mis-posts). **Benign noise** — ignore unless correlated with the issue.
- `Killed` with no systemd stop / OOM in `dmesg` → out of memory.

## 3. Report

- **Timeline of restarts** in the window (each = a downtime gap).
- The **root cause** (the signature that fired), quoting the key line(s).
- The **fix**, and whether it's code (push) or server config (a command the user
  runs). Be explicit which — many prod issues here are config drift the CI deploy
  does NOT auto-apply (it rsyncs `deploy/` but never reinstalls the systemd unit
  or edits `.env`).
- If nothing matches, report the raw errors and say the logs don't show a
  server-side failure (the problem may be client-side or network).
