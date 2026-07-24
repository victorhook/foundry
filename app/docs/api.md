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

## What you can fetch

`GET /api/data` returns everything as a single JSON document:

```jsonc
{
  "workouts":    [ /* each with entries, sets, per-exercise pain & notes */ ],
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

## Notes

- The token is a single shared secret. Rotate it by changing `API_TOKEN` and
  restarting the server.
- Keep it out of source control; pass it via your host's secret manager or a
  `.env` that is not committed.
