import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getExercises,
	getWorkouts,
	getPainNotes,
	getNotes,
	getGoals,
	getProfile,
	getBodyWeights,
	getStepDays,
	getFoodLog,
	getTemplates
} from '$lib/server/db';
import { handleMessage, RPC_ERRORS, SUPPORTED_VERSIONS, type McpSources } from '$lib/server/mcp';
import type { RequestHandler } from './$types';

// MCP endpoint — the Streamable HTTP transport, which is a plain JSON-RPC POST
// when (as here) the server has nothing to stream back. Auth is the same
// read-only API_TOKEN bearer as the rest of docs/api.md, allowed on POST for
// this one path by src/hooks.server.ts. See docs/mcp.md.
//
// The tool surface itself lives in $lib/server/mcp; this file only wires the
// database in and moves JSON over HTTP.

/** Everything the tools are allowed to read. Read-only by construction. */
function sources(): McpSources {
	return {
		now: () => Date.now(),
		timezone: env.TZ,
		exercises: getExercises,
		workouts: getWorkouts,
		painNotes: getPainNotes,
		notes: getNotes,
		goals: getGoals,
		profile: getProfile,
		bodyWeights: getBodyWeights,
		steps: getStepDays,
		foodLog: getFoodLog,
		templates: getTemplates
	};
}

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		// Tell the client how to authenticate rather than just slamming the door —
		// an MCP client showing "401" and nothing else is hard to diagnose.
		throw error(401, 'Not authenticated. Send Authorization: Bearer <API_TOKEN>.');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ jsonrpc: '2.0', id: null, error: { code: RPC_ERRORS.PARSE_ERROR, message: 'Parse error' } });
	}

	const response = handleMessage(body, sources());
	// Notifications get no body; 202 is what the transport spec asks for.
	if (response === null) {
		return new Response(null, { status: 202 });
	}
	return json(response, {
		// Echo the revision we're speaking so a client that checks the header is happy.
		headers: { 'MCP-Protocol-Version': SUPPORTED_VERSIONS[0] }
	});
};

// No server-initiated stream and no session to tear down: this server is
// stateless, so the optional GET and DELETE halves of the transport are unused.
export const GET: RequestHandler = async () => {
	throw error(405, 'This MCP endpoint is POST-only (stateless JSON-RPC; no server-initiated stream).');
};

export const DELETE: RequestHandler = async () => {
	throw error(405, 'This MCP endpoint is stateless; there is no session to delete.');
};
