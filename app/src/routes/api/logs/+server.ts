import { json, error } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import type { RequestHandler } from './$types';

// Read-only view of the service's own systemd journal, so the app (and tooling
// using API_TOKEN) can diagnose prod without SSH. Locked to foundry.service —
// never an arbitrary unit — and gated by the same auth as the rest of /api.
//
// Requires the service user to be able to read the journal: on the box, once,
//   sudo usermod -aG systemd-journal <service-user> && sudo systemctl restart foundry
// Without that, journalctl returns "permission denied" and we surface a hint.
const UNIT = 'foundry.service';
const PRIORITIES = new Set(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']);

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) {
		throw error(401, 'Not authenticated');
	}
	const lines = Math.min(Math.max(parseInt(url.searchParams.get('lines') || '200', 10) || 200, 1), 2000);
	const args = ['-u', UNIT, '-n', String(lines), '--no-pager', '-o', 'short-iso'];
	const priority = url.searchParams.get('priority');
	if (priority && PRIORITIES.has(priority)) {
		args.push('-p', priority);
	}

	const out = await new Promise<{ ok: boolean; text: string; err?: string }>((resolve) => {
		execFile('journalctl', args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => {
			if (e) {
				resolve({ ok: false, text: '', err: (stderr || e.message || '').trim() });
			} else {
				resolve({ ok: true, text: stdout });
			}
		});
	});

	if (!out.ok) {
		return json(
			{
				ok: false,
				error: out.err || 'journalctl failed',
				hint: 'The service user likely lacks journal access. On the server: `sudo usermod -aG systemd-journal <user> && sudo systemctl restart foundry`.'
			},
			{ status: 500 }
		);
	}
	return json({ ok: true, unit: UNIT, lines: out.text.split('\n').filter(Boolean) });
};
