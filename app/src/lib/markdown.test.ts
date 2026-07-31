import { describe, it, expect } from 'vitest';
import { mdToHtml, inlineMd } from './markdown';

// This renders model output straight into the DOM, so escaping is the first thing
// to pin down — then the constructs the agent actually uses.
describe('escaping', () => {
	it('renders HTML in a reply as text, never as markup', () => {
		const html = mdToHtml('<img src=x onerror=alert(1)>');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});

	it('escapes inside code spans and fences too', () => {
		expect(mdToHtml('`<b>hi</b>`')).toContain('&lt;b&gt;hi&lt;/b&gt;');
		expect(mdToHtml('```\n<script>x</script>\n```')).toContain('&lt;script&gt;');
	});

	it('escapes ampersands once, not twice', () => {
		expect(mdToHtml('Squat & Bench')).toBe('<p>Squat &amp; Bench</p>');
	});

	it('refuses non-http link targets', () => {
		// eslint-disable-next-line no-script-url
		const out = mdToHtml('[click](javascript:alert(1))');
		expect(out).not.toContain('href');
		expect(out).toContain('javascript:alert(1)'); // shown as plain text
	});

	it('allows http(s) links, opened safely', () => {
		const out = mdToHtml('[docs](https://example.com/a)');
		expect(out).toContain('<a href="https://example.com/a"');
		expect(out).toContain('rel="noopener noreferrer"');
	});
});

describe('inline formatting', () => {
	it('handles bold, italic and strikethrough', () => {
		expect(inlineMd('**a** *b* ~~c~~')).toBe('<strong>a</strong> <em>b</em> <del>c</del>');
	});

	it('leaves emphasis markers inside code alone', () => {
		// "3*10@20kg" is a set notation the agent writes constantly — the asterisk
		// must not become italics.
		expect(inlineMd('`3*10@20kg`')).toBe('<code>3*10@20kg</code>');
	});

	it('does not italicise a lone asterisk between numbers', () => {
		expect(inlineMd('3*10 and 4*8')).toBe('3*10 and 4*8');
	});

	it('keeps bold when it wraps a whole line', () => {
		expect(inlineMd('**Mon 7/27 — Gym**')).toBe('<strong>Mon 7/27 — Gym</strong>');
	});
});

describe('blocks', () => {
	it('turns headings into bubble-sized headings, never h1', () => {
		expect(mdToHtml('# Week summary')).toBe('<h3>Week summary</h3>');
		expect(mdToHtml('## Monday')).toBe('<h4>Monday</h4>');
		expect(mdToHtml('#### Deep')).toBe('<h4>Deep</h4>');
	});

	it('renders bullet and numbered lists', () => {
		expect(mdToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
		expect(mdToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
	});

	it('keeps paragraphs separate and line breaks inside them', () => {
		expect(mdToHtml('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
	});

	it('renders a fenced code block with its language tag stripped', () => {
		expect(mdToHtml('```json\n{"a":1}\n```')).toBe('<pre><code>{&quot;a&quot;:1}</code></pre>');
	});

	it('renders blockquotes and horizontal rules', () => {
		expect(mdToHtml('> note')).toBe('<blockquote>note</blockquote>');
		expect(mdToHtml('---')).toBe('<hr>');
	});

	it('renders a table inside a scroll container so it cannot widen the page', () => {
		const out = mdToHtml('| Day | Volume |\n| --- | --- |\n| Mon | 1810 kg |');
		expect(out).toContain('<div class="md-table">');
		expect(out).toContain('<th>Day</th>');
		expect(out).toContain('<td>1810 kg</td>');
	});

	it('treats a pipe in prose as prose, not a table', () => {
		expect(mdToHtml('bench | squat')).toBe('<p>bench | squat</p>');
	});

	it('breaks a paragraph around a heading found mid-block', () => {
		expect(mdToHtml('intro\n## Mon\ndetail')).toBe('<p>intro</p><h4>Mon</h4><p>detail</p>');
	});

	it('survives empty and whitespace input', () => {
		expect(mdToHtml('')).toBe('');
		expect(mdToHtml('   \n\n  ')).toBe('');
	});
});

// Real replies rarely put a blank line between a lead line and its bullets, so
// this shape is the common case rather than an edge case.
describe('mixed blocks', () => {
	it('renders bullets that follow a lead line in the same block', () => {
		const out = mdToHtml('**Mon 27th — Gym** · feel `8`\n- Calf Raise: `3×10`\n- Plank: `1×60 sec`');
		expect(out).toContain('<ul>');
		expect(out).toContain('<li>Calf Raise: <code>3×10</code></li>');
		expect(out).not.toContain('- Calf'); // not left as literal text
	});

	it('closes a list when prose resumes after it', () => {
		const out = mdToHtml('lead\n- a\n- b\ntrailing note');
		expect(out).toBe('<p>lead</p><ul><li>a</li><li>b</li></ul><p>trailing note</p>');
	});

	it('keeps bullet and numbered runs as separate lists', () => {
		expect(mdToHtml('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
	});

	it('renders a heading that leads straight into bullets', () => {
		const out = mdToHtml('## Monday\n- squat\n- bench');
		expect(out).toBe('<h4>Monday</h4><ul><li>squat</li><li>bench</li></ul>');
	});

	it('handles a rule between two runs', () => {
		expect(mdToHtml('- a\n---\n- b')).toBe('<ul><li>a</li></ul><hr><ul><li>b</li></ul>');
	});
});
