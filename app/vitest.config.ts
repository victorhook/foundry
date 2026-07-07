import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Server-logic unit tests run in plain Node. SvelteKit's virtual modules aren't
// available here, so `$env/dynamic/private` is aliased to a tiny stub over
// process.env, and `$lib` is mapped to the source dir.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	},
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib'),
			'$env/dynamic/private': path.resolve('./tests/env-stub.ts')
		}
	}
});
