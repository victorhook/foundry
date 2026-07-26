// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			userId: number | null;
			/**
			 * True when the request authenticated with a browser session cookie, as
			 * opposed to the read-only API_TOKEN bearer. Endpoints holding anything
			 * more sensitive than workout data (AI chat transcripts) require this.
			 */
			viaCookie: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
