# MCP server (ChatGPT, Claude, editors)

Foundry speaks the [Model Context Protocol](https://modelcontextprotocol.io) at
`POST /mcp`. Point an MCP client at it and the assistant gets **twelve read-only
tools** over your training data instead of one big JSON blob — it can ask for
"bench press history since April" rather than downloading everything and
filtering.

This is the same data, and the same token, as the [read API](api.md). It is
**read-only**: nothing here can log a workout or change a record.

## Enabling it

The MCP endpoint uses the existing `API_TOKEN`. Set it on the server:

```sh
openssl rand -hex 32     # generate one
```

```sh
# /opt/foundry/.env
API_TOKEN=<the value>
```

With `API_TOKEN` unset the endpoint returns `401` to everything, same as the
read API. Restart the service after changing it.

Your server must be reachable over **HTTPS** — remote MCP clients won't talk to
a plain-HTTP or localhost-only host. If you followed [DEPLOY.md](../DEPLOY.md)
you already have that, and no proxy change is needed: both the Caddy and nginx
configs pass `/mcp` straight through.

## Checking it works

Prove the endpoint is alive before blaming any client:

```sh
curl -s -X POST https://foundry12345.duckdns.org/mcp \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

A JSON result naming `"foundry"` means the server is fine and any failure is in
the client's config. `401` is a wrong or unset token.

To see the tools:

```sh
curl -s -X POST https://foundry12345.duckdns.org/mcp \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools[].name'
```

## Connecting ChatGPT

Custom MCP connectors live behind developer mode, and the UI moves around — the
current path is:

1. **Settings → Apps → Advanced settings** and switch on **Developer mode**.
   (On Business/Enterprise an admin must first allow it under Workspace
   Settings → Permissions & Roles → Connected Data.)
2. **Settings → Connectors → Create**.
3. Fill in:
   - **Name** — `Foundry`
   - **MCP server URL** — `https://foundry12345.duckdns.org/mcp`
   - **Authentication** — **API key**, and paste your `API_TOKEN`
4. Save, then **turn the connector on in the conversation** — a saved connector
   is not active in a chat until you enable it there.

Two things account for most failures: an auth mode that doesn't match the server
(mismatches get rejected silently), and a stale URL. It must be the full
`https://…/mcp`, not the site root.

> Pasting the token into ChatGPT stores it there. Treat it like a password, and
> rotate `API_TOKEN` on the server if it leaks.

## Connecting Claude Code

```sh
claude mcp add --transport http foundry https://foundry12345.duckdns.org/mcp \
  --header "Authorization: Bearer $API_TOKEN"
```

For the Claude desktop/web app, add it as a custom connector with the same URL.

## The tools

| Tool | What it answers |
| --- | --- |
| `get_overview` | What data exists, over what range, recent activity, targets. **Start here.** |
| `list_workouts` | Sessions newest first — date, theme, feel, volume/duration/distance, exercises, pain. Filter by date, theme or exercise. |
| `get_workout` | One session, set by set, with per-exercise notes and pain. |
| `search_exercises` | The exercise library plus how often and how recently each was performed. |
| `get_exercise_history` | One lift across every session, with heaviest set and best session volume. The progression tool. |
| `get_pain` | Pain from all three places it's logged — standalone notes, whole sessions, individual exercises. |
| `get_nutrition` | Food diary totals per day, averages, and your macro targets. `detail: true` for individual items. |
| `get_body_weight` | Weight measurements over a range, with net change. |
| `get_steps` | Daily step counts, total and average. |
| `get_notes` | Day notes, searchable by text. |
| `get_goals` | Training goals and whether they're done. |
| `list_templates` | Saved workout templates and their planned sets. |

Dates are `YYYY-MM-DD` in the timezone set by `TZ`, and `from`/`to` filters are
inclusive. List tools cap at 50 results by default (500 max) and always report
`totalMatched`, so the assistant can tell when it's seeing a slice.

## How it's built

- `src/lib/server/mcp.ts` — tool definitions and the JSON-RPC layer. Pure: the
  database getters are injected, so it's unit-tested without opening SQLite
  (`src/lib/server/mcp.test.ts`).
- `src/routes/mcp/+server.ts` — HTTP transport; wires in `$lib/server/db`.
- `src/hooks.server.ts` — allows the bearer token on `POST /mcp` specifically.

Notes on the implementation:

- **Stateless.** Streamable HTTP with plain JSON responses. There's no session
  to resume and nothing to stream, so `GET` and `DELETE` on `/mcp` return `405`.
- **Dual-era.** It answers both the `initialize` handshake used by current
  clients and the newer `server/discover` (protocol revision `2026-07-28`),
  which declares its version per request.
- **No OAuth.** A single-user app with one shared secret doesn't need it. If a
  client only supports OAuth, it can't connect — use the bearer token or the
  [GPT Action](api.md) instead.
- **No `search`/`fetch` tools.** Those two specific tools are what makes a
  connector eligible as a ChatGPT deep-research / company-knowledge source.
  Adding them would be a small job if you ever want that.

## Which integration should I use?

| | MCP connector | [GPT Action](api.md) |
| --- | --- | --- |
| Granularity | 12 focused tools | one `GET /api/data` dump |
| Works with | ChatGPT, Claude, editors, any MCP client | ChatGPT custom GPTs only |
| Setup | developer mode + connector | build a custom GPT |

The Action still works and is unchanged. MCP is the better option where the
client supports it, mostly because the assistant can fetch just what a question
needs.
