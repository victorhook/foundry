import { json, error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// Nutrition-label reading. When ANTHROPIC_API_KEY is set we use Claude vision
// (fast, far more accurate on real packaging — glare, curved labels, odd fonts).
// Without a key we fall back to on-device Tesseract OCR so the feature still works.

const numFrom = (s: string) => {
	const n = parseFloat(s.replace(',', '.'));
	return isNaN(n) ? null : n;
};

/* ---------- Claude vision (primary) ---------- */

let anthropic: any = null;
async function getAnthropic() {
	if (!anthropic) {
		const { default: Anthropic } = await import('@anthropic-ai/sdk');
		anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	}
	return anthropic;
}

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

async function callClaude(client: any, buf: Buffer, mediaType: string, fast: boolean) {
	// No thinking (this is a tiny extraction) and, when available, fast mode —
	// both to keep latency down.
	const content = [
		{
			type: 'image',
			source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') }
		},
		{ type: 'text', text: PROMPT }
	];
	if (fast) {
		return client.beta.messages.create({
			model: 'claude-opus-4-8',
			max_tokens: 400,
			speed: 'fast',
			betas: ['fast-mode-2026-02-01'],
			messages: [{ role: 'user', content }]
		});
	}
	return client.messages.create({
		model: 'claude-opus-4-8',
		max_tokens: 400,
		messages: [{ role: 'user', content }]
	});
}

async function scanWithClaude(buf: Buffer, mediaType: string) {
	const client = await getAnthropic();
	// Fast mode is a research preview and may not be enabled on every key — if it
	// errors, retry the same request without it before giving up on Claude.
	let res;
	try {
		res = await callClaude(client, buf, mediaType, true);
	} catch {
		res = await callClaude(client, buf, mediaType, false);
	}
	const text = (res.content || [])
		.filter((b: any) => b.type === 'text')
		.map((b: any) => b.text)
		.join('\n');
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

/* ---------- Tesseract (fallback when no API key) ---------- */

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

	try {
		if (env.ANTHROPIC_API_KEY) {
			return json(await scanWithClaude(buf, mediaType));
		}
		return json(await scanWithTesseract(buf));
	} catch (e) {
		// If Claude fails for any reason, try Tesseract before giving up.
		if (env.ANTHROPIC_API_KEY) {
			try {
				return json(await scanWithTesseract(buf));
			} catch {
				/* fall through */
			}
		}
		throw error(500, 'Scan failed');
	}
};
