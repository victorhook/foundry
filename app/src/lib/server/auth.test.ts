import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	hashPassword,
	verifyPassword,
	createSession,
	verifySession
} from './auth';

describe('production AUTH_SECRET guard', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('refuses to start in production without AUTH_SECRET', async () => {
		vi.resetModules();
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('AUTH_SECRET', '');
		await expect(import('./auth')).rejects.toThrow(/AUTH_SECRET/);
	});

	it('starts in production when AUTH_SECRET is set', async () => {
		vi.resetModules();
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('AUTH_SECRET', 'a-real-unique-secret');
		await expect(import('./auth')).resolves.toBeDefined();
	});
});

describe('password hashing', () => {
	it('verifies the correct password', () => {
		const stored = hashPassword('correct horse battery staple');
		expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
	});

	it('rejects the wrong password', () => {
		const stored = hashPassword('hunter2');
		expect(verifyPassword('hunter3', stored)).toBe(false);
	});

	it('uses a random salt (same password → different hashes)', () => {
		expect(hashPassword('same')).not.toBe(hashPassword('same'));
	});

	it('rejects malformed stored values', () => {
		expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
	});
});

describe('session tokens', () => {
	it('round-trips a user id', () => {
		const token = createSession(42);
		expect(verifySession(token)).toBe(42);
	});

	it('rejects a tampered token', () => {
		const token = createSession(7);
		const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
		expect(verifySession(tampered)).toBeNull();
	});

	it('rejects a forged user id (signature no longer matches)', () => {
		const token = createSession(1);
		const parts = token.split('.');
		const forged = `999.${parts[1]}.${parts[2]}`;
		expect(verifySession(forged)).toBeNull();
	});

	it('rejects missing / malformed tokens', () => {
		expect(verifySession(undefined)).toBeNull();
		expect(verifySession('')).toBeNull();
		expect(verifySession('a.b')).toBeNull();
	});
});
