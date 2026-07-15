import { json, error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// Tesseract's language data is cached here so it's only downloaded once.
const CACHE_DIR = path.join(path.dirname(env.DATABASE_PATH || 'data/foundry.db'), 'tesseract');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// One shared worker across requests (loading the wasm + lang data is expensive).
let workerPromise: Promise<any> | null = null;
async function getWorker() {
	if (!workerPromise) {
		const { createWorker } = await import('tesseract.js');
		workerPromise = createWorker('eng', 1, { cachePath: CACHE_DIR }).catch((e: unknown) => {
			workerPromise = null;
			throw e;
		});
	}
	return workerPromise;
}

const numFrom = (s: string) => {
	const n = parseFloat(s.replace(',', '.'));
	return isNaN(n) ? null : n;
};

// Best-effort extraction of macros from OCR'd nutrition-label text.
function parseMacros(text: string) {
	const t = text.replace(/\r/g, '\n');
	const flat = t.replace(/\n/g, ' ');

	// Calories: prefer an explicit kcal figure, else "calories N".
	let kcal: number | null = null;
	const kcalM = flat.match(/(\d[\d.,]*)\s*k?cal/i) || flat.match(/calor\w*\D{0,6}(\d[\d.,]*)/i) || flat.match(/energy\D{0,12}?(\d[\d.,]*)\s*kcal/i);
	if (kcalM) { kcal = numFrom(kcalM[1]); }

	const grab = (re: RegExp) => { const m = flat.match(re); return m ? numFrom(m[1]) : null; };
	const protein = grab(/protein\D{0,8}(\d[\d.,]*)\s*g/i);
	const carbs = grab(/(?:carbohydrate|carbs?|carbo)\D{0,8}(\d[\d.,]*)\s*g/i);
	// Avoid matching "saturated fat" / "trans fat" for the total fat figure.
	const fatM = flat.match(/(?<!satur\w{0,6}\s)(?<!trans\s)(?<!of which\s)fat\D{0,8}(\d[\d.,]*)\s*g/i);
	const fat = fatM ? numFrom(fatM[1]) : null;

	const per100 = /per\s*100\s*g|\/\s*100\s*g|100\s*g\b/i.test(flat);
	const perServing = /per\s*(serving|portion|serve)/i.test(flat);
	const basis = per100 ? '100g' : perServing ? 'serving' : null;

	return { kcal, protein, carbs, fat, basis };
}

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
	let text = '';
	try {
		const worker = await getWorker();
		const res = await worker.recognize(buf);
		text = res.data.text || '';
	} catch (e) {
		throw error(500, 'OCR failed');
	}
	return json({ ...parseMacros(text), text });
};
