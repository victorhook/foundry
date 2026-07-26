import { describe, it, expect } from 'vitest';
import { createTurnParser } from './claude';

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
