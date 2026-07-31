import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import type { ChatTool } from './db';

// Bridge to the `claude` CLI installed on this server. The CLI runs headless
// (`-p --output-format stream-json`) and owns the real conversation state; we
// resume a chat by passing its session UUID back with `--resume`.
//
// Everything the agent does happens inside a scratch workspace (AI_WORKSPACE,
// default ./ai-workspace — /opt/foundry/ai-workspace in production). Edits are
// auto-accepted there so the agent never blocks on a permission prompt that
// nobody is watching. See docs/ai-chat.md for what that does and does not
// contain.

/** The agent's working directory. The route writes its data export in here. */
export const WORKSPACE = path.resolve(env.AI_WORKSPACE || 'ai-workspace');
const TURN_TIMEOUT_MS = Number(env.CLAUDE_TURN_TIMEOUT_MS || 10 * 60 * 1000);

const HOME = env.CLAUDE_HOME || process.env.HOME || WORKSPACE;

function executable(p: string): boolean {
	try {
		fs.accessSync(p, fs.constants.X_OK);
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * Where the CLI actually is. Explicit CLAUDE_BIN wins; otherwise look on PATH and
 * then in the per-user install location, because that's where the official
 * installer puts it (`~/.local/bin`) and a systemd unit's default PATH does not
 * include it. Returns the bare name when nothing is runnable, so the ENOENT
 * error message stays useful — and so claudeAvailable() can report "not set up".
 */
export function findBin(opts: { explicit?: string; pathEnv?: string; home: string }): string {
	if (opts.explicit) { return opts.explicit; }
	const onPath = (opts.pathEnv || '')
		.split(path.delimiter)
		.filter(Boolean)
		.map((d) => path.join(d, 'claude'))
		.find(executable);
	if (onPath) { return onPath; }
	const perUser = path.join(opts.home, '.local', 'bin', 'claude');
	return executable(perUser) ? perUser : 'claude';
}

const BIN = findBin({ explicit: env.CLAUDE_BIN, pathEnv: process.env.PATH, home: HOME });

// Tools the chat agent may use. Deliberately excludes Task (subagents would
// multiply cost invisibly) and the git/PR helpers — this is a chat, not CI.
const TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'];

// Belt-and-braces guardrails. `acceptEdits` already scopes Edit/Write to the
// workspace, but Bash is not confined by cwd — these deny rules block the
// commands most likely to do damage if the model is talked into it by something
// it reads on the web. Not a security boundary (see docs/ai-chat.md); a speed
// bump that keeps ordinary accidents from becoming outages. Verified to take
// effect: a denied call shows up in the CLI's `permission_denials`.
function denyRules(): string[] {
	// The app's own secrets and database, wherever they actually live — better
	// than hardcoding production paths that silently match nothing in dev.
	const envFile = path.resolve(env.DOTENV_PATH || '.env');
	const dbFile = path.resolve(env.DATABASE_PATH || 'data/foundry.db');
	const secrets = [envFile, dbFile, '/etc/shadow'];
	return [
		'Bash(sudo *)',
		'Bash(su *)',
		'Bash(systemctl *)',
		'Bash(shutdown *)',
		'Bash(reboot *)',
		'Bash(rm -rf /*)',
		'Bash(mkfs*)',
		'Bash(dd *)',
		'Bash(chown *)',
		'Bash(chmod 777 *)',
		'Bash(curl * | sh)',
		'Bash(curl * | bash)',
		'Bash(crontab *)',
		...secrets.flatMap((f) => [`Read(${f})`, `Edit(${f})`, `Write(${f})`])
	];
}

function systemPrompt(snapshot: string | null): string {
	const lines = [
		'You are the assistant built into Foundry, a personal fitness-tracking web app.',
		'You are talking to the app owner through a chat page on their phone, so keep',
		'replies short and readable on a small screen — no wide tables, no long preambles.',
		'You are running headless on the app server: nobody can answer a permission',
		'prompt or a clarifying question mid-task, so make reasonable calls yourself and',
		'say what you assumed. Your working directory is a scratch directory — use it',
		'for any files you need. Do not modify the Foundry app or its database.',
		'',
		'Format replies as Markdown: **bold** for the things worth noticing, bullet',
		'lists for sets and per-day breakdowns, ## headings only when a reply genuinely',
		'has sections. Use `code` sparingly — for file names, commands and identifiers,',
		'not for ordinary numbers: write 82.5 kg and feel 8/10 as plain text, since a',
		'reply where every figure is boxed is harder to read, not easier. Tables are',
		'supported but keep them to two or three narrow columns — this is a phone.',
		'No h1, and lead with the answer rather than a preamble.'
	];
	if (snapshot) {
		lines.push(
			`The owner's full Foundry data is in ${snapshot} — workouts with sets, body`,
			'weights, steps, nutrition, notes, goals and targets. It is refreshed before',
			'every turn, so read it whenever a question touches their training, food,',
			'weight or progress; start there rather than looking for a database or an API.',
			'',
			'Be efficient — most questions are one or two commands. Start by reading the',
			'file\'s "_readme" and "_recipes" fields: _recipes holds ready-made jq queries',
			'for the common questions (this week, an exercise over time, weekly volume,',
			'body-weight trend, recent nutrition), so prefer adapting one of those to',
			'writing your own pipeline. Dates, weekday names, exercise names and per-set',
			'volume totals are ALREADY computed in the file — you do not need `date`, an',
			'exerciseId lookup, or a scratch script for any of them.',
			'',
			'`jq` and `python3` are installed; use them directly rather than checking',
			'whether they exist. The file holds the owner\'s entire history and can run to',
			'hundreds of KB, so select the slice you need instead of reading it whole.'
		);
	} else {
		lines.push(
			'No Foundry data export is available this turn, so you cannot answer questions',
			'about the owner\'s training or nutrition — say so rather than guessing.'
		);
	}
	return lines.join(' ');
}

// The agent's shell can run `env`, so the child gets an allowlist rather than a
// copy of the app's environment — otherwise AUTH_SECRET, ADMIN_PASSWORD, API_TOKEN
// and the Google Fit client secret would all be readable by anything the agent
// decides to run (or is talked into running by a web page it fetches).
const ENV_ALLOW = new Set([
	'PATH', 'TZ', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR',
	'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
	'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'
]);
// The CLI's own configuration and credentials.
const ENV_ALLOW_PREFIXES = ['CLAUDE_', 'ANTHROPIC_'];

export function childEnv(): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v === undefined) { continue; }
		if (ENV_ALLOW.has(k) || ENV_ALLOW_PREFIXES.some((p) => k.startsWith(p))) {
			out[k] = v;
		}
	}
	// systemd units often have no HOME; without one the CLI can't find its
	// credentials or its session transcripts.
	out.HOME = HOME;
	// Keep the child from trying to draw a TUI into a pipe.
	out.CI = '1';
	out.TERM = 'dumb';
	return out;
}

export type ClaudeEvent =
	| { type: 'session'; sessionId: string }
	| { type: 'delta'; text: string }
	| { type: 'tool'; name: string; detail: string }
	| { type: 'done'; text: string; tools: ChatTool[] }
	| { type: 'error'; message: string };

/**
 * True when the CLI looks runnable — drives the "not set up yet" empty state so
 * the first failure is an explanation rather than a mystery. A false positive
 * still ends in a clear error on the first turn (see the ENOENT branch below).
 */
export function claudeAvailable(): boolean {
	// resolveBin() only returns the bare name when it found nothing runnable.
	return BIN.includes('/') && executable(BIN);
}

/** One-line summary of a tool call, for the "used Bash: …" line in the transcript. */
function toolDetail(name: string, input: any): string {
	if (!input || typeof input !== 'object') { return ''; }
	if (name === 'Bash') { return String(input.command ?? ''); }
	if (name === 'WebSearch') { return String(input.query ?? ''); }
	if (name === 'WebFetch') { return String(input.url ?? ''); }
	if (name === 'TodoWrite') { return ''; }
	const p = input.file_path ?? input.path ?? input.pattern;
	if (!p) { return ''; }
	// Paths inside the workspace are shown relative — the absolute prefix is the
	// same on every line and eats the whole chip on a phone.
	const s = String(p);
	return s.startsWith(WORKSPACE + path.sep) ? s.slice(WORKSPACE.length + 1) : s;
}

function buildArgs(prompt: string, resume: string | null, snapshot: string | null): string[] {
	const args = [
		'-p',
		prompt,
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
		'--permission-mode',
		'acceptEdits',
		'--tools',
		...TOOLS,
		'--append-system-prompt',
		systemPrompt(snapshot),
		'--settings',
		JSON.stringify({ permissions: { deny: denyRules() } })
	];
	if (env.CLAUDE_MODEL) { args.push('--model', env.CLAUDE_MODEL); }
	if (resume) { args.push('--resume', resume); }
	return args;
}

/**
 * Turns the CLI's newline-delimited JSON into ClaudeEvents. Stateful (it
 * accumulates text and tool calls across lines), pure otherwise — no process,
 * no I/O — which is what the unit tests exercise.
 */
export function createTurnParser() {
	const tools: ChatTool[] = [];
	const textParts: string[] = [];
	let sawResult = false;

	return {
		/** Did a `result` line arrive? If not, the turn died and `finish` reports it. */
		get complete() {
			return sawResult;
		},
		/** Events for one line of stdout. Unparseable lines are ignored. */
		line(raw: string): ClaudeEvent[] {
			let msg: any;
			try {
				msg = JSON.parse(raw);
			} catch (e) {
				return []; // non-JSON noise on stdout
			}
			if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
				return [{ type: 'session', sessionId: String(msg.session_id) }];
			}
			if (msg.type === 'stream_event') {
				const ev = msg.event;
				// Only text deltas — input_json_delta is tool arguments being
				// assembled, which we report once the block is complete instead.
				if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
					const t = String(ev.delta.text ?? '');
					textParts.push(t);
					return [{ type: 'delta', text: t }];
				}
				return [];
			}
			if (msg.type === 'assistant') {
				const out: ClaudeEvent[] = [];
				for (const b of msg.message?.content ?? []) {
					if (b.type === 'tool_use') {
						const t = { name: String(b.name ?? 'tool'), detail: toolDetail(b.name, b.input) };
						tools.push(t);
						out.push({ type: 'tool', ...t });
					}
				}
				return out;
			}
			if (msg.type === 'result') {
				sawResult = true;
				const out: ClaudeEvent[] = [];
				if (msg.session_id) { out.push({ type: 'session', sessionId: String(msg.session_id) }); }
				if (msg.is_error) {
					out.push({
						type: 'error',
						message: String(msg.result || msg.subtype || 'The agent run failed.')
					});
				} else {
					// `result` holds the final assistant text and is authoritative;
					// fall back to the accumulated deltas if it's missing.
					const text = typeof msg.result === 'string' && msg.result ? msg.result : textParts.join('');
					out.push({ type: 'done', text, tools: tools.slice() });
				}
				return out;
			}
			return [];
		},
		/** Called once the process exits without having produced a result. */
		finish(stderr: string): ClaudeEvent[] {
			if (sawResult) { return []; }
			return [
				{
					type: 'error',
					message: stderr.trim() || 'The agent exited without returning a result.'
				}
			];
		}
	};
}

/**
 * Run one conversational turn. Yields events as the CLI produces them; always
 * ends with exactly one `done` or one `error`. Abort the signal to kill the turn
 * (the browser closing the SSE stream does this).
 */
export async function* runTurn(opts: {
	prompt: string;
	resume: string | null;
	signal?: AbortSignal;
	/** Path to the caller's data export, mentioned in the system prompt. */
	snapshot?: string | null;
}): AsyncGenerator<ClaudeEvent> {
	fs.mkdirSync(WORKSPACE, { recursive: true });

	const child = spawn(BIN, buildArgs(opts.prompt, opts.resume, opts.snapshot ?? null), {
		cwd: WORKSPACE,
		env: childEnv(),
		stdio: ['ignore', 'pipe', 'pipe']
	});

	// Events are pushed here by the stdout reader and drained by the generator.
	const queue: ClaudeEvent[] = [];
	let notify: (() => void) | null = null;
	let finished = false;
	const wake = () => {
		if (notify) {
			const n = notify;
			notify = null;
			n();
		}
	};
	const push = (e: ClaudeEvent) => {
		queue.push(e);
		wake();
	};

	let stderr = '';
	const parser = createTurnParser();

	const timer = setTimeout(() => {
		stderr += `\nTurn exceeded ${Math.round(TURN_TIMEOUT_MS / 1000)}s and was stopped.`;
		child.kill('SIGTERM');
	}, TURN_TIMEOUT_MS);

	const onAbort = () => child.kill('SIGTERM');
	opts.signal?.addEventListener('abort', onAbort);

	const handleLine = (line: string) => {
		for (const ev of parser.line(line)) {
			// A bare subtype like "error_during_execution" tells the user nothing.
			// Whatever the CLI wrote to stderr usually says what actually happened,
			// so attach it — this error lands in the chat transcript.
			if (ev.type === 'error' && stderr.trim() && !ev.message.includes(stderr.trim().slice(0, 40))) {
				push({ type: 'error', message: `${ev.message}\n\n${stderr.trim().slice(-1200)}` });
				continue;
			}
			push(ev);
		}
	};

	let buf = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk: string) => {
		buf += chunk;
		let nl: number;
		while ((nl = buf.indexOf('\n')) !== -1) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (line) { handleLine(line); }
		}
	});
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		if (stderr.length < 4000) { stderr += chunk; }
	});

	child.on('error', (err: any) => {
		const hint =
			err?.code === 'ENOENT'
				? `The \`claude\` CLI was not found (looked for "${BIN}"). Install it on the server or set CLAUDE_BIN.`
				: String(err?.message || err);
		push({ type: 'error', message: hint });
		finished = true;
		wake();
	});
	child.on('close', () => {
		if (buf.trim()) { handleLine(buf.trim()); }
		for (const ev of parser.finish(stderr)) { push(ev); }
		finished = true;
		wake();
	});

	try {
		while (true) {
			while (queue.length) {
				yield queue.shift() as ClaudeEvent;
			}
			if (finished) { return; }
			await new Promise<void>((resolve) => {
				notify = resolve;
			});
		}
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
		if (child.exitCode === null) { child.kill('SIGTERM'); }
	}
}
