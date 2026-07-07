import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

// A dev fallback keeps local runs working; production MUST set AUTH_SECRET.
const SECRET = env.AUTH_SECRET || 'dev-insecure-secret-change-me';
const SESSION_DAYS = 30;

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

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
