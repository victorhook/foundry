import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';
import { building } from '$app/environment';

// A dev fallback keeps local runs working; production MUST set a real AUTH_SECRET.
const DEV_FALLBACK_SECRET = 'dev-insecure-secret-change-me';
const IS_PROD = process.env.NODE_ENV === 'production';

// Fail loud rather than run on a publicly-known secret (which would let anyone
// forge session cookies). Skipped during `building` — the build imports this
// module to analyse routes, and env vars aren't (and shouldn't be) present then.
if (!building && IS_PROD && (!env.AUTH_SECRET || env.AUTH_SECRET === DEV_FALLBACK_SECRET)) {
	throw new Error(
		'AUTH_SECRET must be set to a unique value in production ' +
			'(generate one with `openssl rand -hex 32`). Refusing to start on the insecure dev fallback.'
	);
}

const SECRET = env.AUTH_SECRET || DEV_FALLBACK_SECRET;
const SESSION_DAYS = 30;

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** Cookie options shared by login and the rolling-refresh hook. */
export function sessionCookieOptions(secure: boolean) {
	return {
		path: '/' as const,
		httpOnly: true,
		sameSite: 'lax' as const,
		secure,
		maxAge: SESSION_MAX_AGE
	};
}

/** scrypt password hash, stored as `salt:hash` (both hex). */
export function hashPassword(password: string): string {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = crypto.scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) {
		return false;
	}
	const test = crypto.scryptSync(password, salt, 64).toString('hex');
	const a = Buffer.from(hash, 'hex');
	const b = Buffer.from(test, 'hex');
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Stateless signed session token: `userId.expiryMs.hmac`. */
export function createSession(userId: number): string {
	const exp = Date.now() + SESSION_MAX_AGE * 1000;
	const payload = `${userId}.${exp}`;
	const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
	return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): number | null {
	if (!token) {
		return null;
	}
	const parts = token.split('.');
	if (parts.length !== 3) {
		return null;
	}
	const [userId, exp, sig] = parts;
	const payload = `${userId}.${exp}`;
	const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
	const sigBuf = Buffer.from(sig);
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
		return null;
	}
	if (Date.now() > Number(exp)) {
		return null;
	}
	return Number(userId);
}
