import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercises the real pdf.js path — the point of this module is that a physio's
// PDF becomes text the model can read, and a mock of that proves nothing.

let dir: string;
let readProgramDocument: typeof import('./documents').readProgramDocument;

/** A one-object-per-line PDF with whatever content stream we're given. */
function makePdf(contentStream: string): Buffer {
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

const text = (lines: string[]) =>
	`BT /F1 18 Tf 72 700 Td ${lines.map((l) => `(${l}) Tj 0 -24 Td`).join(' ')} ET`;

beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-docs-'));
	// Set before the import: ./uploads reads UPLOAD_DIR when it loads.
	process.env.UPLOAD_DIR = dir;
	({ readProgramDocument } = await import('./documents'));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name: string, bytes: Buffer) => fs.writeFileSync(path.join(dir, name), bytes);

describe('readProgramDocument', () => {
	it('extracts a PDF text layer page by page', async () => {
		write('plan.pdf', makePdf(text(['Week 1: Squat 3x5 @ 100kg', 'Week 2: Squat 3x5 @ 105kg'])));
		const doc = await readProgramDocument('plan.pdf', 'application/pdf');
		expect(doc).toMatchObject({ type: 'text', mime: 'application/pdf', pages: 1, truncated: false });
		expect((doc as any).text).toContain('Week 2: Squat 3x5 @ 105kg');
	});

	it('says a PDF with no text layer is a scan rather than calling it empty', async () => {
		write('scan.pdf', makePdf('0 0 0 RG 10 10 m 100 100 l S'));
		const doc = await readProgramDocument('scan.pdf', 'application/pdf');
		expect(doc).toMatchObject({ type: 'unavailable' });
		expect((doc as any).reason).toContain('no text layer');
	});

	it('reports a corrupt PDF instead of throwing into the tool call', async () => {
		write('broken.pdf', Buffer.from('not a pdf at all'));
		const doc = await readProgramDocument('broken.pdf', 'application/pdf');
		expect(doc).toMatchObject({ type: 'unavailable' });
	});

	it('base64s an image for the model to look at', async () => {
		write('coach.png', Buffer.from([1, 2, 3, 4]));
		const doc = await readProgramDocument('coach.png', 'image/png');
		expect(doc).toEqual({ type: 'image', mime: 'image/png', base64: 'AQIDBA==', bytes: 4 });
	});

	it('turns a missing file into a fact, not an exception', async () => {
		expect(await readProgramDocument('gone.pdf', 'application/pdf')).toMatchObject({ type: 'unavailable' });
	});

	it('has nothing to read when no file is attached', async () => {
		expect(await readProgramDocument(null, null)).toBeNull();
	});

	it('refuses a type it cannot show', async () => {
		write('plan.docx', Buffer.from('PK'));
		const doc = await readProgramDocument('plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		expect((doc as any).reason).toContain('Unsupported');
	});

	it('cannot be walked out of the upload directory', async () => {
		expect(await readProgramDocument('../../etc/passwd', 'application/pdf')).toMatchObject({ type: 'unavailable' });
	});
});
