# Read API (automation)

Foundry exposes a **read-only** HTTP API so you can pull your data into
scripts, notebooks, or other tools.

## Enabling it

Set an `API_TOKEN` environment variable on the server to a long random secret:

```sh
# generate one
openssl rand -hex 32
```

If `API_TOKEN` is unset or empty, the API is disabled (bearer requests are
rejected like any other unauthenticated request).

## Authenticating

Send the token as a bearer credential on `GET` requests:

```sh
curl -H "Authorization: Bearer $API_TOKEN" https://<your-host>/api/data
```

- Only `GET` is accepted with a bearer token — the token cannot create or
  modify anything.
- Bearer requests never receive a session cookie.
- Requests without a valid cookie **or** matching bearer token get `401`.
- `/api/chat*` is the one exception: AI chat transcripts require a browser
  session, not a bearer token, because they can contain command output and file
  contents. See [`ai-chat.md`](ai-chat.md).

## What you can fetch

`GET /api/data` returns everything as a single JSON document:

```jsonc
{
  "workouts":    [ /* each with entries, sets, per-exercise pain & notes */ ],
  "painNotes":   [ /* standalone pain logs: {at, note, items:[{cat,level}]} */ ],
  "reminders":   [ /* pain-logging push reminders: {days, time, enabled} */ ],
  "exercises":   [ ... ],
  "notes":       [ ... ],
  "goals":       [ ... ],
  "templates":   [ ... ],
  "programs":    [ ... ],
  "foods":       [ ... ],
  "meals":       [ ... ],
  "profile":     { ... },
  "bodyWeights": [ ... ],
  "steps":       [ ... ],
  "painCategories": [ ... ],
  "muscleGroups":   [ ... ],
  "workoutThemes":  [ ... ],
  "albums": [ ... ],
  "photos": [ ... ],
  "fitConnected": true
}
```

Example — list workout dates and their exercise counts:

```sh
curl -s -H "Authorization: Bearer $API_TOKEN" https://<your-host>/api/data \
  | jq '.workouts[] | {date: (.startedAt/1000 | todate), exercises: (.entries | length)}'
```

## Use with ChatGPT (custom GPT Action)

An OpenAPI 3.1 spec is provided at [`openapi.yaml`](./openapi.yaml). To wire it
into a custom GPT:

1. In ChatGPT, create/edit a GPT → **Configure** → **Create new action**.
2. Paste the contents of `openapi.yaml` into the schema box (or import it).
3. Edit the `servers[0].url` to your real origin, e.g.
   `https://fitness.yourdomain.com` (must be HTTPS).
4. Under **Authentication**, choose **API Key**, Auth Type **Bearer**, and paste
   your `API_TOKEN` value.
5. Save. The GPT can now call `getAllData` and answer questions over your
   workouts, notes, goals, nutrition, steps, etc.

The whole dataset comes back in one `GET /api/data` call — there's no
pagination, so the GPT fetches once and filters (e.g. "workouts in the last 4
weeks") itself. Since it's read-only, the GPT can't modify anything.

> Heads up: pasting the token into a GPT's Action stores it with that GPT.
> Treat it like a password, and rotate `API_TOKEN` on the server if it leaks.

## Notes

- The token is a single shared secret. Rotate it by changing `API_TOKEN` and
  restarting the server.
- Keep it out of source control; pass it via your host's secret manager or a
  `.env` that is not committed.
