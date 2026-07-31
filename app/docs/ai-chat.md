# AI chat

Foundry's **AI chat** page is a chat UI in front of the `claude` CLI running on
your own VPS. There is no separate AI service: the SvelteKit server spawns
`claude -p` per turn, streams its output to your phone over SSE, and resumes the
same CLI session on the next message.

It is a real agent, not a chat completion — it can run shell commands, read and
write files, and search the web, all inside a scratch workspace on the server.

## How it works

```
phone ──POST /api/chat/stream──▶ SvelteKit ──spawn──▶ claude -p --output-format stream-json
      ◀────── SSE deltas ──────           ◀── NDJSON events ──
```

| Piece | Where |
|---|---|
| CLI bridge (spawn, parse, guardrails) | `src/lib/server/claude.ts` |
| Data export shape (pure) | `src/lib/server/snapshot.ts` |
| Data export writer (reads the DB) | `src/lib/server/snapshot-write.ts` |
| Chat list / transcript CRUD | `src/routes/api/chat/+server.ts` |
| One streamed turn | `src/routes/api/chat/stream/+server.ts` |
| Tables `chat`, `chat_message` | `src/lib/server/db.ts` (migration v20 → v21) |
| Views, streaming client | `src/lib/foundry.ts` (`viewChats`, `viewChat`, `sendChat`) |

## How it sees your Foundry data

The agent has **no database connection and no API token** — deliberately, so
nothing running in the sandbox can write to Foundry or exfiltrate a credential.
Instead, every turn writes `foundry-data.json` into the workspace (read-only,
mode 444) and the system prompt tells the agent it's there.

It contains workouts with their sets, exercises, body weights, steps, notes,
goals, profile targets, and the last 60 days of the food diary.

**The derived work is done server-side, on purpose.** The first version handed
over raw rows and a turn cost ~21 shell commands: converting epoch timestamps
with `date -d`, joining exerciseIds to names, and shelling out to python to sum
sets. Each workout now carries `day` / `weekday` / `time` / `weekStartMonday`
already in the server's timezone, `volumeKg` (total load moved), `durationMin`
and `distanceKm`, and `exercises[]` with **names already resolved**. `volumeKg`
is null where kilograms would be a lie — a `sec` unit puts seconds in the weight
field, and bodyweight exercises log no external load.

Pain is the one thing Foundry records in two unrelated places — standalone
`painNotes[]` and pain attached to a workout (`pains[]` per session,
`exercises[].pain` per movement). The export carries both and the `_readme` says
so explicitly, because an answer built from half of it still reads as
authoritative.

`_readme` explains the shape; `_recipes` ships ready-made jq queries for the
common questions (this week, one exercise over time, weekly volume, body-weight
trend, recent nutrition). Together those took the same question from ~21 commands
to 2-4. Keep each recipe short and to a single `jq` call — an earlier version wrapped a
nested `$(jq ...)` subshell and the agent flailed around it, which the turn log
made obvious.

**`TZ` must be set** in `/opt/foundry/.env` or every date is UTC-based.

`counts` is included so the agent can size the file before deciding how to read
it. Full history is kept — progress questions span years — which means roughly
2 KB per logged session, so the prompt tells it to query with `jq` rather than
read the whole thing into context.

If you'd rather it query live instead, the pieces are there: Foundry already has
a read-only bearer API (`docs/api.md`). It's not wired up on purpose — that would
put a credential inside the sandbox, and the agent does go looking for one.

**Conversation state lives in the CLI**, not in Foundry. Each chat row stores the
CLI's session UUID (`chat.cli_session`); every turn after the first passes it back
with `--resume`, so context, and the agent's memory of what it did, carry over.
Foundry's own `chat_message` rows exist so the phone can re-render a transcript
without asking the CLI to replay it. Deleting a chat in Foundry removes those
rows — the CLI's transcript under `~/.claude/projects/` is untouched.

Both endpoints sit behind the normal session cookie (`hooks.server.ts`), so only
a signed-in browser can reach them. The read-only `API_TOKEN` bearer path is
`GET`-only and therefore cannot start a turn.

## Setup on the VPS

The service runs as the `User=` in `deploy/foundry.service` (`victor`), and the
CLI installs **per-user** into `~/.local/bin`. So do all of this over SSH as that
same user — no `sudo`, which the installer refuses anyway (under `sudo` it would
install into root's home and the service would never find it).

**1. Install the CLI.**

```bash
ssh victor@<your-vps>
curl -fsSL https://claude.ai/install.sh | bash
~/.local/bin/claude --version
```

**2. Sign in with your Claude subscription** and mint a long-lived token for the
service:

```bash
claude setup-token      # follow the printed URL, paste the code back
```

Put the token it prints in `/opt/foundry/.env`:

```
CLAUDE_CODE_OAUTH_TOKEN=<the token>
```

This is subscription auth, not an API key. The service reads `.env` via
`EnvironmentFile=` and passes it to the CLI, so it doesn't depend on an
interactive login staying valid in your shell.

*Alternative:* `claude auth login` alone also works — it writes
`~/.claude/.credentials.json`, which the service picks up because `HOME` points
there. Simpler, but a `claude auth logout` in your own shell then breaks the chat
page. Verify either way with `claude auth status`.

**3. Point the service at the CLI.** `deploy/foundry.service` sets
`HOME=/home/victor` and a `PATH` including `/home/victor/.local/bin`. **Both must
match `User=`** — the CLI keeps its credentials *and* its session transcripts
under `$HOME/.claude`, so with the wrong `HOME` `--resume` silently starts a fresh
conversation on every turn.

```bash
sudo cp /opt/foundry/deploy/foundry.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart foundry
```

**4. Check the reverse proxy.** An agent turn can run for minutes and streams
throughout, so the proxy must not buffer it or time it out.

*This VPS runs **nginx***, not Caddy — `deploy/setup-nginx.sh` disables Caddy
because the box also serves another site on :80/:443. **Usually nothing to do:**
the app sends `X-Accel-Buffering: no` (which nginx honours per-response, so the
stream isn't buffered) and a heartbeat every 15s (which keeps nginx's default 60s
`proxy_read_timeout` from firing during a quiet turn). Try the chat first.

If replies arrive all at once at the end, or long turns get cut off, make it
explicit — add this **above** the `location /` block in
`/etc/nginx/sites-available/foundry`, then `sudo nginx -t && sudo systemctl reload nginx`:

```nginx
location = /api/chat/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 15m;
    proxy_send_timeout 15m;
    gzip off;
}
```

`setup-nginx.sh` now writes this block too, but it's a run-once script and
certbot has since rewritten the live vhost — so edit the live file rather than
re-running it.

*If you ever move to Caddy* (`deploy/Caddyfile`, the generic path in `DEPLOY.md`),
the equivalent settings are `flush_interval -1`, `read_timeout 15m`, and no gzip
on `text/event-stream`. Caddy generally streams `text/event-stream` without
buffering already, so treat those as making the intent explicit rather than as a
known fix — verify against Caddy's current docs if you actually switch. Untested
here: this box runs nginx.

Verify from the phone: drawer → **AI chat** → *New chat*. If the page says the CLI
isn't installed, `CLAUDE_BIN` is wrong or the CLI isn't on the service's `PATH`.

## What the agent can and cannot do

It runs with `--permission-mode acceptEdits` (nobody is watching a prompt) and a
fixed tool set: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`,
`WebFetch`, `TodoWrite`. Its working directory is `AI_WORKSPACE`
(`/opt/foundry/ai-workspace` by default), created on first use.

There is also a deny list in `claude.ts` covering `sudo`, `systemctl`, `rm -rf /`,
`curl … | sh`, writes to `.env`, and similar.

**The child process gets an environment allowlist, not a copy of the app's.** The
agent's shell can read its own environment, so `AUTH_SECRET`, `ADMIN_PASSWORD`,
`API_TOKEN`, `DATABASE_PATH` and the Google Fit client secret are stripped; only
`CLAUDE_*` / `ANTHROPIC_*`, `PATH`, `HOME`, `TZ`, locale and proxy variables get
through (`childEnv()`, unit-tested). In practice the CLI also refuses to run
`env`/`printenv` without approval, which nobody can give headless — but don't rely
on that, it's the CLI's policy and it could change.

**Worth doing:** `sudo chown root:root /opt/foundry/.env && sudo chmod 600
/opt/foundry/.env`. systemd reads `EnvironmentFile=` as root *before* dropping to
`User=`, so the service still starts, while the agent — running as that user —
can't `cat` the file. Nothing else on the VPS reads it.

> **Be clear-eyed about the boundary.** `acceptEdits` confines `Edit`/`Write` to
> the workspace, but **`Bash` is not confined by the working directory** — a shell
> command can read or write anything the service user can, including
> `data/foundry.db` and your photos. The deny list blocks the obvious footguns; it
> is not a sandbox, and a prompt-injection payload on a web page the agent fetches
> is a real path to running commands as that user.
>
> If you want a genuine boundary, run the CLI as a separate unprivileged user
> that owns only the workspace (a `systemd-run --uid=` wrapper around `CLAUDE_BIN`,
> or a container). Until then, treat the AI chat as equivalent to giving yourself
> a shell on the box from your phone — which, given it is behind your login, may
> be exactly what you want.

## Configuration

All optional except credentials. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Subscription token from `claude setup-token` |
| `CLAUDE_BIN` | `claude` | Path to the CLI when it isn't on `PATH` |
| `AI_WORKSPACE` | `./ai-workspace` | Agent working directory |
| `CLAUDE_HOME` | `$HOME` | Override where the CLI looks for credentials |
| `CLAUDE_MODEL` | CLI default | e.g. `opus`, `sonnet`, or a full model name |
| `CLAUDE_TURN_TIMEOUT_MS` | `600000` | Kill a turn that runs longer than this |
| `AI_CHAT_LOG` | `<db dir>/ai-chat.log` | Per-turn debug log (see below) |

## Behaviour worth knowing

- **One turn at a time per chat.** A second concurrent turn on the same chat gets
  a `409` — two `--resume`s would interleave into one CLI transcript.
- **Leaving the page stops the turn.** Closing the SSE stream kills the child
  process; whatever text had already streamed is saved as the reply.
- **Partial replies are kept.** If the CLI dies or the connection drops mid-turn,
  the text received so far is stored rather than discarded, so a chat never ends
  on a user message with no answer.
- **Tool calls are summarised, not listed.** A turn can run a dozen commands, so
  the transcript shows one line ("4 steps · Bash ×4") that expands on tap. The
  full, untruncated command list goes to `AI_CHAT_LOG` (mode 600, one JSON object
  per turn, rotated at 5 MB) — deliberately outside the workspace so the agent
  can't read or edit its own logs. The CLI's own transcripts under
  `$HOME/.claude/projects/<slug>/*.jsonl` have tool *outputs* too, when that
  isn't enough.
- **Replies are Markdown.** Headings, bold, italics, lists, code, blockquotes,
  rules and narrow tables render; anything else shows as text. The renderer
  (`src/lib/markdown.ts`) escapes before inserting markup and only allows
  `http(s)` links, so reply text can't inject HTML — see `markdown.test.ts`.
- **Cost is per turn, on your Anthropic account.** A chatty agent turn with many
  tool calls costs meaningfully more than one message looks like. `CLAUDE_MODEL`
  and the CLI's own `--effort` default are the levers.

## Testing

`src/lib/server/claude.test.ts` covers the NDJSON event parsing (deltas, tool
calls, error results, a process that dies without a result) against fixtures
copied from real CLI output — no spawning, no API calls.

The e2e test (`e2e/foundry.spec.ts`, *"AI chat"*) covers the page, chat
lifecycle, and persistence but deliberately **never sends a message**: that would
spawn the real CLI and spend credits on every test run.
