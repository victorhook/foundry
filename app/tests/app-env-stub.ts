// Test stand-in for SvelteKit's `$app/environment` virtual module.
// building=false so the production guards are exercised under Vitest.
export const building = false;
export const dev = true;
export const browser = false;
export const version = 'test';
