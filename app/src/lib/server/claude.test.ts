import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTurnParser, findBin, childEnv, onPath } from './claude';

// The agent's Bash tool can read its own environment, so anything we hand the
// child process is readable by whatever the model decides to run — including a
// command it was talked into by a web page it fetched. The app's own secrets
// must therefore never be in there.
describe('childEnv', () => {
	afterEach(() => vi.unstubAllEnvs());

	const secrets = {
		AUTH_SECRET: 'session-signing-secret',
		ADMIN_USER: 'victor',
		ADMIN_PASSWORD: 'hunter2',
		API_TOKEN: 'read-api-bearer-token',
		GOOGLE_CLIENT_ID: 'google-id',
		GOOGLE_CLIENT_SECRET: 'google-secret',
		DATABASE_PATH: '/opt/foundry/data/foundry.db'
	};

	it('withholds every app secret from the agent', () => {
		for (const [k, v] of Object.entries(secrets)) { vi.stubEnv(k, v); }
		const e = childEnv();
		for (const k of Object.keys(secrets)) {
			expect(e[k], `${k} must not reach the agent`).toBeUndefined();
		}
		// Belt-and-braces: no value from .env should appear under any other name.
		expect(Object.values(e)).not.toContain('hunter2');
		expect(Object.values(e)).not.toContain('read-api-bearer-token');
	});

	it('passes through what the CLI needs to run and authenticate', () => {
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'oat-token');
		vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-key');
		vi.stubEnv('TZ', 'Europe/Stockholm');
		vi.stubEnv('HTTPS_PROXY', 'http://proxy:8080');
		const e = childEnv();
		expect(e.CLAUDE_CODE_OAUTH_TOKEN).toBe('oat-token');
		expect(e.ANTHROPIC_API_KEY).toBe('sk-ant-key');
		// TZ matters for correctness, not just cosmetics: it decides which calendar
		// day "this week" starts on.
		expect(e.TZ).toBe('Europe/Stockholm');
		expect(e.HTTPS_PROXY).toBe('http://proxy:8080');
		expect(e.PATH).toBeDefined();
	});

	it('always sets HOME, and a non-interactive terminal', () => {
		const e = childEnv();
		expect(e.HOME).toBeTruthy();
		expect(e.CI).toBe('1');
		expect(e.TERM).toBe('dumb');
	});

	it('drops unknown variables rather than allowing them through', () => {
		vi.stubEnv('SOME_FUTURE_SECRET', 'nope');
		expect(childEnv().SOME_FUTURE_SECRET).toBeUndefined();
	});
});

// Locating the CLI. The production failure this guards against: the official
// installer puts `claude` in ~/.local/bin, which a systemd unit's default PATH
// does not include — so PATH-only lookup finds nothing on a correctly installed
// server and the chat page reports "not installed".
describe('findBin', () => {
	let root: string;
	let onPathDir: string;
	let home: string;

	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-findbin-'));
		onPathDir = path.join(root, 'usr-bin');
		home = path.join(root, 'home');
		fs.mkdirSync(onPathDir, { recursive: true });
		fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
	});
	afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

	const install = (dir: string) => {
		const p = path.join(dir, 'claude');
		fs.writeFileSync(p, '#!/bin/sh\n', { mode: 0o755 });
		return p;
	};
	const uninstall = (dir: string) => fs.rmSync(path.join(dir, 'claude'), { force: true });

	it('honours an explicit CLAUDE_BIN without probing anything', () => {
		expect(findBin({ explicit: '/custom/claude', pathEnv: onPathDir, home })).toBe('/custom/claude');
	});

	it('finds it on PATH when it is there', () => {
		const p = install(onPathDir);
		expect(findBin({ pathEnv: onPathDir, home })).toBe(p);
		uninstall(onPathDir);
	});

	it('falls back to $HOME/.local/bin when PATH does not include it', () => {
		const p = install(path.join(home, '.local', 'bin'));
		// A systemd unit's default PATH — no per-user bin directory.
		expect(findBin({ pathEnv: '/usr/local/bin:/usr/bin:/bin', home })).toBe(p);
		uninstall(path.join(home, '.local', 'bin'));
	});

	it('prefers PATH over the per-user location when both exist', () => {
		const onPath = install(onPathDir);
		install(path.join(home, '.local', 'bin'));
		expect(findBin({ pathEnv: onPathDir, home })).toBe(onPath);
		uninstall(onPathDir);
		uninstall(path.join(home, '.local', 'bin'));
	});

	it('returns the bare name when nothing is runnable, so the error stays useful', () => {
		expect(findBin({ pathEnv: onPathDir, home })).toBe('claude');
	});

	it('ignores a non-executable file of the right name', () => {
		const p = path.join(onPathDir, 'claude');
		fs.writeFileSync(p, 'not executable', { mode: 0o644 });
		expect(findBin({ pathEnv: onPathDir, home })).toBe('claude');
		fs.rmSync(p, { force: true });
	});
});

// Fixtures are trimmed copies of real `claude -p --output-format stream-json`
// output, so this locks in the wire shapes the parser depends on.
const init = (session: string) =>
	JSON.stringify({ type: 'system', subtype: 'init', session_id: session, tools: [] });

const textDelta = (text: string) =>
	JSON.stringify({
		type: 'stream_event',
		event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
	});

const toolUse = (name: string, input: unknown) =>
	JSON.stringify({
		type: 'assistant',
		message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name, input }] }
	});

const result = (extra: Record<string, unknown>) =>
	JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...extra });

/** Flatten a whole transcript through the parser. */
function run(lines: string[]) {
	const p = createTurnParser();
	const events = lines.flatMap((l) => p.line(l));
	return { events, parser: p };
}

describe('createTurnParser', () => {
	it('reports the session id from the init line', () => {
		const { events } = run([init('abc-123')]);
		expect(events).toEqual([{ type: 'session', sessionId: 'abc-123' }]);
	});

	it('streams text deltas and finishes with the authoritative result text', () => {
		const { events } = run([
			init('s1'),
			textDelta('Hello '),
			textDelta('there'),
			result({ session_id: 's1', result: 'Hello there' })
		]);
		expect(events.filter((e) => e.type === 'delta')).toEqual([
			{ type: 'delta', text: 'Hello ' },
			{ type: 'delta', text: 'there' }
		]);
		expect(events.at(-1)).toEqual({ type: 'done', text: 'Hello there', tools: [] });
	});

	it('falls back to accumulated deltas when result carries no text', () => {
		const { events } = run([textDelta('par'), textDelta('tial'), result({ result: '' })]);
		expect(events.at(-1)).toEqual({ type: 'done', text: 'partial', tools: [] });
	});

	it('summarises tool calls and repeats them on the done event', () => {
		const { events } = run([
			toolUse('Bash', { command: 'ls -la', description: 'List files' }),
			toolUse('WebSearch', { query: 'protein synthesis' }),
			result({ result: 'ok' })
		]);
		expect(events.filter((e) => e.type === 'tool')).toEqual([
			{ type: 'tool', name: 'Bash', detail: 'ls -la' },
			{ type: 'tool', name: 'WebSearch', detail: 'protein synthesis' }
		]);
		const done = events.at(-1) as any;
		expect(done.tools).toEqual([
			{ name: 'Bash', detail: 'ls -la' },
			{ name: 'WebSearch', detail: 'protein synthesis' }
		]);
	});

	it('ignores tool-argument deltas, which are not assistant text', () => {
		const argDelta = JSON.stringify({
			type: 'stream_event',
			event: {
				type: 'content_block_delta',
				delta: { type: 'input_json_delta', partial_json: '{"command": "ls' }
			}
		});
		const { events } = run([argDelta]);
		expect(events).toEqual([]);
	});

	it('ignores non-JSON noise and event types it does not care about', () => {
		const { events } = run([
			'not json at all',
			'',
			JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }),
			JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting' }),
			JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } })
		]);
		expect(events).toEqual([]);
	});

	it('turns an errored result into an error event, not a done event', () => {
		const { events } = run([
			JSON.stringify({
				type: 'result',
				subtype: 'error_during_execution',
				is_error: true,
				result: 'Credit balance too low'
			})
		]);
		expect(events).toEqual([{ type: 'error', message: 'Credit balance too low' }]);
	});

	// Observed shape of a real auth failure (bad CLAUDE_CODE_OAUTH_TOKEN): the CLI
	// exits 0 and labels the line `subtype: "success"`, but sets is_error and puts
	// the message in `result`. So `is_error` is the only trustworthy signal —
	// keying off exit code or subtype would report a 401 as a normal reply.
	it('treats is_error as authoritative even when subtype says success', () => {
		const { events } = run([
			JSON.stringify({
				type: 'result',
				subtype: 'success',
				is_error: true,
				api_error_status: 401,
				terminal_reason: 'api_error',
				session_id: 's1',
				result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.'
			})
		]);
		expect(events).toEqual([
			{ type: 'session', sessionId: 's1' },
			{
				type: 'error',
				message: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.'
			}
		]);
	});

	it('reports stderr when the process dies before producing a result', () => {
		const p = createTurnParser();
		p.line(textDelta('half an answer'));
		expect(p.complete).toBe(false);
		expect(p.finish('claude: command not found')).toEqual([
			{ type: 'error', message: 'claude: command not found' }
		]);
	});

	it('stays quiet on exit once a result has already been emitted', () => {
		const p = createTurnParser();
		p.line(result({ result: 'done' }));
		expect(p.complete).toBe(true);
		expect(p.finish('some harmless warning on stderr')).toEqual([]);
	});

	it('explains a missing result even when stderr is empty', () => {
		const p = createTurnParser();
		expect(p.finish('   ')).toEqual([
			{ type: 'error', message: 'The agent exited without returning a result.' }
		]);
	});
});

// The system prompt asserts which tools exist. It got that wrong in production —
// it claimed jq was installed on a box that had no jq, and the agent burned
// commands discovering that. So the claim is probed, and the probe is tested.
describe('onPath', () => {
	let dir: string;
	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-onpath-'));
		fs.writeFileSync(path.join(dir, 'jq'), '#!/bin/sh\n', { mode: 0o755 });
		fs.writeFileSync(path.join(dir, 'notexec'), 'x', { mode: 0o644 });
	});
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

	it('finds an executable on the given PATH', () => {
		expect(onPath('jq', dir)).toBe(true);
	});

	it('reports missing tools as missing', () => {
		expect(onPath('definitely-not-installed', dir)).toBe(false);
	});

	it('does not count a non-executable file of the right name', () => {
		expect(onPath('notexec', dir)).toBe(false);
	});

	it('searches every PATH entry, not just the first', () => {
		expect(onPath('jq', `/nonexistent${path.delimiter}${dir}`)).toBe(true);
	});

	it('copes with an empty PATH', () => {
		expect(onPath('jq', '')).toBe(false);
	});
});
