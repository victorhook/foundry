import { json, error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { analyzeImage, claudeAvailable } from '$lib/server/claude';
import type { RequestHandler } from './$types';

// Nutrition-label reading. We use Claude vision — far more accurate on real
// packaging (glare, curved labels, odd fonts, Swedish/European layouts) than OCR
// — via the `claude` CLI on the owner's Claude subscription, the same auth the
// chat uses (see src/lib/server/claude.ts). No API key needed. If the CLI isn't
// set up (or it errors) we fall back to on-device Tesseract OCR so the feature
// still works, just less well.

const numFrom = (s: string) => {
	const n = parseFloat(s.replace(',', '.'));
	return isNaN(n) ? null : n;
};

/* ---------- Claude vision (primary) ---------- */

const PROMPT =
	'You are reading a nutrition-facts label, most likely Swedish or otherwise European. ' +
	'Extract the macronutrients PER 100 g. European labels always have a "per 100 g" (or "per 100 ml") ' +
	'column — use that column. Only if no per-100 g values exist, use the per-serving values instead. ' +
	'Energy must be in kcal: if only kJ is shown, divide by 4.184. Protein, carbs and fat are in grams. ' +
	'Respond with ONLY a compact JSON object and nothing else, in exactly this shape: ' +
	'{"kcal":number|null,"protein":number|null,"carbs":number|null,"fat":number|null,"basis":"100g"|"serving"|null}. ' +
	'Use null for any value you cannot read. "basis" is "100g" if you used a per-100 g column, "serving" if you had to fall back to per-serving.';

function parseJsonLoose(s: string) {
	const m = s.match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		return JSON.parse(m[0]);
	} catch {
		return null;
	}
}

// Turn Claude's JSON reply into the macro shape the client expects.
function shapeMacros(text: string) {
	const parsed = parseJsonLoose(text) || {};
	const pick = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);
	return {
		kcal: pick(parsed.kcal),
		protein: pick(parsed.protein),
		carbs: pick(parsed.carbs),
		fat: pick(parsed.fat),
		basis: parsed.basis === '100g' || parsed.basis === 'serving' ? parsed.basis : null,
		text
	};
}

async function scanWithClaude(buf: Buffer, mediaType: string) {
	return shapeMacros(await analyzeImage(buf, mediaType, PROMPT));
}

/* ---------- Tesseract (fallback when the CLI isn't available) ---------- */

const CACHE_DIR = path.join(path.dirname(env.DATABASE_PATH || 'data/foundry.db'), 'tesseract');
let workerPromise: Promise<any> | null = null;
async function getWorker() {
	if (!workerPromise) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		const { createWorker } = await import('tesseract.js');
		workerPromise = createWorker('eng', 1, { cachePath: CACHE_DIR }).catch((e: unknown) => {
			workerPromise = null;
			throw e;
		});
	}
	return workerPromise;
}

// Best-effort extraction of macros from OCR'd nutrition-label text.
function parseMacros(text: string) {
	const t = text.replace(/\r/g, '\n');
	const flat = t.replace(/\n/g, ' ');

	let kcal: number | null = null;
	const kcalM =
		flat.match(/(\d[\d.,]*)\s*k?cal/i) ||
		flat.match(/calor\w*\D{0,6}(\d[\d.,]*)/i) ||
		flat.match(/energy\D{0,12}?(\d[\d.,]*)\s*kcal/i);
	if (kcalM) {
		kcal = numFrom(kcalM[1]);
	}

	const grab = (re: RegExp) => {
		const m = flat.match(re);
		return m ? numFrom(m[1]) : null;
	};
	const protein = grab(/protein\D{0,8}(\d[\d.,]*)\s*g/i);
	const carbs = grab(/(?:carbohydrate|carbs?|carbo)\D{0,8}(\d[\d.,]*)\s*g/i);
	const fatM = flat.match(/(?<!satur\w{0,6}\s)(?<!trans\s)(?<!of which\s)fat\D{0,8}(\d[\d.,]*)\s*g/i);
	const fat = fatM ? numFrom(fatM[1]) : null;

	const per100 = /per\s*100\s*g|\/\s*100\s*g|100\s*g\b/i.test(flat);
	const perServing = /per\s*(serving|portion|serve)/i.test(flat);
	const basis = per100 ? '100g' : perServing ? 'serving' : null;

	return { kcal, protein, carbs, fat, basis };
}

async function scanWithTesseract(buf: Buffer) {
	const worker = await getWorker();
	const res = await worker.recognize(buf);
	const text = res.data.text || '';
	return { ...parseMacros(text), text };
}

/* ---------- Route ---------- */

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) {
		throw error(400, 'No image');
	}
	const buf = Buffer.from(await file.arrayBuffer());
	const mediaType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';

	const haveClaude = claudeAvailable();
	try {
		return json(haveClaude ? await scanWithClaude(buf, mediaType) : await scanWithTesseract(buf));
	} catch (e) {
		// If the Claude CLI fails for any reason, fall back to Tesseract before giving up.
		if (haveClaude) {
			try {
				return json(await scanWithTesseract(buf));
			} catch {
				/* fall through */
			}
		}
		throw error(500, 'Scan failed');
	}
};
