import fs from 'node:fs';
import { uploadPath } from './uploads';

// Reading an uploaded program document (a training plan, rehab protocol or
// event) in a shape a language model can actually use.
//
// A program is a file the owner photographed or was emailed — a PDF from a
// physio, a screenshot of a coach's spreadsheet. The MCP tools hand the model
// text for PDFs (extracted here) and the picture itself for images, because
// those are the two things every client can consume. See ./mcp.ts.

/** What a program's attached file turned into. */
export type ProgramDocument =
	/** A PDF's text layer, page by page. */
	| { type: 'text'; mime: string; pages: number; text: string; truncated: boolean }
	/** An image, base64'd for an MCP `image` content block. */
	| { type: 'image'; mime: string; base64: string; bytes: number }
	/** There is a file, but we can't turn it into anything readable. */
	| { type: 'unavailable'; mime: string | null; reason: string };

/** Enough for a long training plan; a runaway PDF won't eat the context window. */
const MAX_TEXT = 40_000;
/**
 * Images are downscaled in the browser before upload, so anything above this is
 * unexpected — and a multi-megabyte base64 blob costs more context than the
 * picture is worth.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Image types Claude (and every other vision model worth naming) accepts. */
const VIEWABLE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Page separator in the extracted text — cheap, and models read it fine. */
const pageHeader = (n: number, of: number) => `--- page ${n} of ${of} ---`;

/**
 * pdf.js, loaded on demand. The *legacy* build for the same reason the browser
 * uses it (src/lib/foundry.ts): the modern one relies on APIs this runtime
 * doesn't have. `verbosity: 0` keeps its font warnings out of the service log —
 * we only ever want the text layer, never a rendered page.
 */
async function extractPdfText(bytes: Buffer): Promise<{ pages: number; text: string; truncated: boolean }> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(bytes),
		verbosity: 0,
		isEvalSupported: false,
		useSystemFonts: false,
		disableFontFace: true
	}).promise;
	try {
		const pages: string[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			// Items are positioned runs, not lines: `hasEOL` is where pdf.js saw the
			// line end, so honouring it is what keeps a set/rep table readable.
			let line = '';
			const lines: string[] = [];
			for (const item of content.items as any[]) {
				if (typeof item.str !== 'string') { continue; }
				line += item.str;
				if (item.hasEOL) {
					lines.push(line.trimEnd());
					line = '';
				}
			}
			if (line.trim()) { lines.push(line.trimEnd()); }
			pages.push(lines.join('\n').trim());
			page.cleanup();
		}
		// Headers only when there's more than one page — and only around pages that
		// actually said something, so "empty" stays detectable by the caller.
		const full = pages.every((p) => !p)
			? ''
			: pages
					.map((p, i) => (doc.numPages > 1 ? `${pageHeader(i + 1, doc.numPages)}\n${p}` : p))
					.join('\n\n')
					.trim();
		return {
			pages: doc.numPages,
			text: full.length > MAX_TEXT ? full.slice(0, MAX_TEXT) : full,
			truncated: full.length > MAX_TEXT
		};
	} finally {
		await doc.destroy();
	}
}

/**
 * Read the file attached to a program. Never throws: a missing or unreadable
 * document is a fact about the data, which the model should be told plainly
 * rather than an error that fails the whole tool call.
 */
export async function readProgramDocument(
	filename: string | null,
	mime: string | null
): Promise<ProgramDocument | null> {
	if (!filename) { return null; }

	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(uploadPath(filename));
	} catch (e) {
		return { type: 'unavailable', mime, reason: 'The attached file is missing from disk.' };
	}

	if (mime === 'application/pdf') {
		try {
			const out = await extractPdfText(bytes);
			if (!out.text) {
				// A scan or a photographed page: real content, no text layer, and
				// nothing here can rasterise it. Say which it is so the model asks the
				// owner instead of concluding the program is empty.
				return {
					type: 'unavailable',
					mime,
					reason: `This PDF is ${out.pages} page(s) of images with no text layer (a scan or photo), so its contents can't be read here. The owner can see it in the app under Programs.`
				};
			}
			return { type: 'text', mime, pages: out.pages, text: out.text, truncated: out.truncated };
		} catch (e) {
			return { type: 'unavailable', mime, reason: `The PDF could not be read: ${(e as Error).message}` };
		}
	}

	if (mime && VIEWABLE_IMAGES.has(mime)) {
		if (bytes.length > MAX_IMAGE_BYTES) {
			return {
				type: 'unavailable',
				mime,
				reason: `The image is ${Math.round(bytes.length / 1024 / 1024)} MB, too large to include.`
			};
		}
		return { type: 'image', mime, base64: bytes.toString('base64'), bytes: bytes.length };
	}

	return { type: 'unavailable', mime, reason: `Unsupported document type "${mime || 'unknown'}".` };
}
