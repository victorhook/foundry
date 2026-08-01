import { error } from '@sveltejs/kit';
import {
	getChat,
	getChatCliSession,
	setChatCliSession,
	addChatMessage,
	renameChat,
	type ChatTool
} from '$lib/server/db';
import { runTurn, WORKSPACE, mcpHealthy } from '$lib/server/claude';
import { writeSnapshot } from '$lib/server/snapshot-write';
import { logTurn } from '$lib/server/chatlog';
import type { RequestHandler } from './$types';

// One conversational turn, streamed to the browser as SSE. POST (not EventSource)
// so the prompt can go in the body; the client reads the response stream itself.
//
// Body: { chatId, text }
// Events: {type:'delta',text} | {type:'tool',name,detail} | {type:'done',...} | {type:'error',message}

// A chat has one CLI session, and two concurrent turns resuming it would
// interleave into the same transcript. Reject the second one.
const busy = new Set<string>();

const HEARTBEAT_MS = 15_000;

/** First line of the first message, used as the chat's title. */
function titleFrom(text: string): string {
	const line = text.trim().split('\n')[0].trim();
	return (line.length > 60 ? line.slice(0, 57) + '…' : line) || 'New chat';
}

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId || !locals.viaCookie) {
		throw error(401, 'Not authenticated');
	}
	const b = await request.json().catch(() => ({}) as any);
	const chatId = String(b.chatId ?? '');
	const text = String(b.text ?? '').trim();
	if (!chatId || !text) {
		throw error(400, 'chatId and text required');
	}
	const chat = getChat(chatId);
	if (!chat) {
		throw error(404, 'Chat not found');
	}
	if (busy.has(chatId)) {
		throw error(409, 'This chat is already generating a reply');
	}

	// First message names the chat (matches how the CLI titles its own sessions).
	if (chat.messages.length === 0 && chat.title === 'New chat') {
		renameChat(chatId, titleFrom(text));
	}
	addChatMessage(chatId, 'user', text);

	busy.add(chatId);
	const resume = getChatCliSession(chatId);
	const enc = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;
			const send = (obj: unknown) => {
				if (closed) { return; }
				try {
					controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
				} catch (e) {
					closed = true;
				}
			};
			// Keeps the proxy and the phone's radio from giving up on a quiet turn
			// (the agent can think or run a long command with no output for a while).
			const beat = setInterval(() => {
				if (closed) { return; }
				try {
					controller.enqueue(enc.encode(': ping\n\n'));
				} catch (e) {
					closed = true;
				}
			}, HEARTBEAT_MS);

			let acc = '';
			const tools: ChatTool[] = [];
			let persisted = false;
			let outcome = 'interrupted';
			let denials: string[] = [];
			let failure: string | null = null;
			const startedAt = Date.now();

			// Ask the MCP endpoint whether it's really there before betting the turn on
			// it: the tools posture removes the shell, so a configured-but-absent
			// endpoint would leave the agent with no route to the data at all.
			const port = new URL(request.url).port || undefined;
			const mcp = await mcpHealthy(port);
			// With the tools live the agent queries the database directly, so there is
			// nothing to export — skip the ~90 KB write and the read behind it.
			const snapshot = mcp ? null : writeSnapshot(WORKSPACE, process.env.TZ);

			try {
				for await (const ev of runTurn({ prompt: text, resume, signal: request.signal, snapshot, port, mcp })) {
					if (ev.type === 'session') {
						// Store on the first turn; harmless to rewrite if it ever changes.
						setChatCliSession(chatId, ev.sessionId);
						continue;
					}
					if (ev.type === 'delta') {
						acc += ev.text;
						send(ev);
						continue;
					}
					if (ev.type === 'tool') {
						tools.push({ name: ev.name, detail: ev.detail });
						send(ev);
						continue;
					}
					if (ev.type === 'done') {
						addChatMessage(chatId, 'assistant', ev.text, ev.tools);
						persisted = true;
						outcome = 'ok';
						denials = ev.denials ?? [];
						send({ type: 'done', text: ev.text, tools: ev.tools });
						continue;
					}
					if (ev.type === 'error') {
						// Keep any partial answer — a half reply beats losing the turn.
						if (acc.trim()) {
							addChatMessage(chatId, 'assistant', acc, tools);
						}
						persisted = true;
						outcome = 'error';
						failure = ev.message;
						send({ type: 'error', message: ev.message });
					}
				}
			} catch (e: any) {
				send({ type: 'error', message: String(e?.message || e) });
			} finally {
				// Client hung up (or the turn died) before a result: don't leave the
				// user's message sitting there with no reply in the transcript.
				if (!persisted && acc.trim()) {
					addChatMessage(chatId, 'assistant', acc, tools);
				}
				// Full command list to disk — the UI only shows a summary now.
				logTurn({
					chatId,
					cliSession: getChatCliSession(chatId),
					outcome,
					prompt: text,
					reply: acc,
					tools,
					ms: Date.now() - startedAt,
					error: failure,
					denials
				});
				clearInterval(beat);
				busy.delete(chatId);
				closed = true;
				try {
					controller.close();
				} catch (e) {
					/* already closed by the client */
				}
			}
		},
		cancel() {
			busy.delete(chatId);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// Tells nginx (and Caddy's reverse_proxy) not to buffer the stream.
			'x-accel-buffering': 'no'
		}
	});
};
