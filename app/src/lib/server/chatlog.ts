import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import type { ChatTool } from './db';

// Per-turn debug log. The chat UI shows a one-line summary of what the agent ran;
// the full command list lands here, so a turn that went sideways can be read back
// afterwards without the transcript being a wall of text.
//
// Deliberately NOT inside the agent's workspace: it must not be something the
// agent can read back, edit, or trip over while working. Defaults next to the
// database.
//
// The CLI keeps its own far more detailed transcripts (tool inputs *and* outputs)
// under $HOME/.claude/projects/<workspace-slug>/*.jsonl — reach for those when
// this isn't enough.

const MAX_BYTES = 5 * 1024 * 1024;

function logPath(): string {
	if (env.AI_CHAT_LOG) { return path.resolve(env.AI_CHAT_LOG); }
	const dbDir = path.dirname(path.resolve(env.DATABASE_PATH || 'data/foundry.db'));
	return path.join(dbDir, 'ai-chat.log');
}

export type TurnLog = {
	chatId: string;
	cliSession: string | null;
	/** 'ok' | 'error' | 'interrupted' */
	outcome: string;
	prompt: string;
	reply: string;
	tools: ChatTool[];
	ms: number;
	error?: string | null;
	/** Commands the CLI's permission layer refused, if any. */
	denials?: string[];
};

/** One JSON object per line: greppable, and appendable without parsing. */
export function formatTurn(t: TurnLog, at: number): string {
	return JSON.stringify({
		at: new Date(at).toISOString(),
		chatId: t.chatId,
		cliSession: t.cliSession,
		outcome: t.outcome,
		ms: t.ms,
		// Enough to identify the turn without dumping the whole conversation.
		prompt: t.prompt.length > 500 ? t.prompt.slice(0, 500) + '…' : t.prompt,
		replyChars: t.reply.length,
		error: t.error || null,
		toolCount: t.tools.length,
		// A headless turn cannot get approval, so a denial means the reply is
		// probably an apology rather than an answer. Record it either way.
		denials: t.denials?.length ? t.denials : undefined,
		// The bit the UI now hides: every command, in order, untruncated.
		tools: t.tools.map((x) => ({ name: x.name, detail: x.detail }))
	});
}

/** Append a turn. Best-effort: logging must never break a chat. */
export function logTurn(t: TurnLog): void {
	try {
		const file = logPath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		// Single-generation rotation. Enough to debug a recent turn; without it the
		// file grows forever on a box with no logrotate config for it.
		try {
			if (fs.statSync(file).size > MAX_BYTES) {
				fs.renameSync(file, file + '.1');
			}
		} catch (e) {
			/* no file yet */
		}
		fs.appendFileSync(file, formatTurn(t, Date.now()) + '\n', { mode: 0o600 });
	} catch (e) {
		/* a full or read-only disk shouldn't cost the user their reply */
	}
}
