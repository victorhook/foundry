// Google Fit REST API integration.
//
// Foundry is server-backed, so the whole OAuth dance lives here: the browser
// only ever sees step *numbers*, never a token. Flow:
//   1. /api/fit/connect  -> redirect the user to Google's consent screen.
//   2. /api/fit/callback -> exchange the code for tokens, store the refresh
//      token (long-lived) + access token in SQLite.
//   3. /api/fit/sync     -> refresh the access token if stale, then aggregate
//      daily step counts and upsert them into step_day.
//
// NOTE: Google is deprecating the Fit REST API in favour of Health Connect, so
// treat this as a pragmatic stopgap, not a forever solution.

import { env } from '$env/dynamic/private';
import { getFitAccount, saveFitTokens } from './db';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AGGREGATE_URL = 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate';

// Read-only access to activity data (steps live here). Nothing else is requested.
const SCOPE = 'https://www.googleapis.com/auth/fitness.activity.read';

const DAY_MS = 86_400_000;

export function fitConfigured(): boolean {
	return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function clientId(): string {
	const id = env.GOOGLE_CLIENT_ID;
	if (!id) {
		throw new Error('GOOGLE_CLIENT_ID is not set');
	}
	return id;
}

function clientSecret(): string {
	const secret = env.GOOGLE_CLIENT_SECRET;
	if (!secret) {
		throw new Error('GOOGLE_CLIENT_SECRET is not set');
	}
	return secret;
}

/** The OAuth redirect target. Must match a URI registered in the Google Cloud
 *  console exactly. Defaults to <origin>/api/fit/callback; override with
 *  GOOGLE_REDIRECT_URI when running behind a proxy that rewrites the origin. */
export function redirectUri(origin: string): string {
	return env.GOOGLE_REDIRECT_URI || `${origin}/api/fit/callback`;
}

/** Build the consent-screen URL. `access_type=offline` + `prompt=consent` is what
 *  makes Google hand back a refresh token (only on the first authorization). */
export function buildAuthUrl(origin: string): string {
	const params = new URLSearchParams({
		client_id: clientId(),
		redirect_uri: redirectUri(origin),
		response_type: 'code',
		scope: SCOPE,
		access_type: 'offline',
		include_granted_scopes: 'true',
		prompt: 'consent'
	});
	return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code for tokens and persist them. */
export async function exchangeCode(code: string, origin: string): Promise<void> {
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId(),
			client_secret: clientSecret(),
			redirect_uri: redirectUri(origin),
			grant_type: 'authorization_code'
		})
	});
	if (!res.ok) {
		throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
	}
	const data = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
	saveFitTokens({
		refresh_token: data.refresh_token ?? null,
		access_token: data.access_token,
		access_expiry: Date.now() + data.expires_in * 1000
	});
}

/** Return a valid access token, refreshing (and persisting) it if it's stale. */
async function getAccessToken(): Promise<string> {
	const acct = getFitAccount();
	if (!acct?.refresh_token) {
		throw new Error('Google Fit is not connected');
	}
	// 60s skew guard so we don't hand back a token that expires mid-request.
	if (acct.access_token && acct.access_expiry && acct.access_expiry - 60_000 > Date.now()) {
		return acct.access_token;
	}
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			refresh_token: acct.refresh_token,
			client_id: clientId(),
			client_secret: clientSecret(),
			grant_type: 'refresh_token'
		})
	});
	if (!res.ok) {
		throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
	}
	const data = (await res.json()) as { access_token: string; expires_in: number };
	saveFitTokens({
		access_token: data.access_token,
		access_expiry: Date.now() + data.expires_in * 1000
	});
	return data.access_token;
}

/** Local-time YYYY-MM-DD for a timestamp (buckets are labelled by their start). */
function localDay(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Fetch daily step totals for the last `days` calendar days (including today).
 * Buckets are aligned to local midnight so each row maps to a real calendar day.
 * Returns oldest-first [{ day, steps }].
 */
export async function fetchStepDays(days: number): Promise<Array<{ day: string; steps: number }>> {
	const token = await getAccessToken();

	// Start at local midnight `days-1` days ago; end at "now" so today is partial
	// but present. Bucketing by 24h from a local-midnight start keeps buckets on
	// calendar-day boundaries (ignoring the rare DST hour, fine for a step count).
	const now = new Date();
	const startMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	startMidnight.setDate(startMidnight.getDate() - (days - 1));
	const startTimeMillis = startMidnight.getTime();
	const endTimeMillis = now.getTime();

	const res = await fetch(AGGREGATE_URL, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			// Aggregate by data type only (no explicit dataSourceId): Google merges
			// all step sources server-side and returns its estimated daily total —
			// the same number the Fit app shows. Pinning the derived estimated_steps
			// source directly 403s ("not readable") for many accounts.
			aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
			bucketByTime: { durationMillis: DAY_MS },
			startTimeMillis,
			endTimeMillis
		})
	});
	if (!res.ok) {
		throw new Error(`Fit aggregate failed (${res.status}): ${await res.text()}`);
	}

	const data = (await res.json()) as {
		bucket?: Array<{
			startTimeMillis: string;
			dataset: Array<{ point: Array<{ value: Array<{ intVal?: number }> }> }>;
		}>;
	};

	const out: Array<{ day: string; steps: number }> = [];
	for (const bucket of data.bucket ?? []) {
		let steps = 0;
		for (const ds of bucket.dataset ?? []) {
			for (const pt of ds.point ?? []) {
				for (const v of pt.value ?? []) {
					steps += v.intVal ?? 0;
				}
			}
		}
		out.push({ day: localDay(Number(bucket.startTimeMillis)), steps });
	}
	return out;
}
