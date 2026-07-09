#!/usr/bin/env node
// Create or update a login, without touching the rest of the database.
//
//   node scripts/set-user.mjs <username> <password>
//
// Uses the same scrypt hash format as the app (salt:hash, hex, keylen 64).
// Honors DATABASE_PATH (defaults to data/foundry.db), so on the server run:
//   DATABASE_PATH=/opt/foundry/data/foundry.db node scripts/set-user.mjs <user> <pass>
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
	console.error('Usage: node scripts/set-user.mjs <username> <password>');
	process.exit(1);
}

function hashPassword(pw) {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

const dbPath = process.env.DATABASE_PATH || 'data/foundry.db';
const db = new Database(dbPath);
db.exec(
	`CREATE TABLE IF NOT EXISTS user (
		id INTEGER PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);`
);

const hash = hashPassword(password);
const existing = db.prepare('SELECT id FROM user WHERE username = ?').get(username);
if (existing) {
	db.prepare('UPDATE user SET password_hash = ? WHERE username = ?').run(hash, username);
	console.log(`Updated password for "${username}" in ${dbPath}`);
} else {
	db.prepare('INSERT INTO user (username, password_hash) VALUES (?, ?)').run(username, hash);
	console.log(`Created user "${username}" in ${dbPath}`);
}
