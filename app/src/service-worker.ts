/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Minimal offline-capable app-shell cache.
// - Precaches the built app + static files on install.
// - Navigations: network-first, falling back to the cached shell when offline.
// - Built assets: cache-first.
// API requests are never cached here — the client handles offline drafts itself.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `foundry-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') {
		return;
	}
	const url = new URL(request.url);
	if (url.origin !== location.origin || url.pathname.startsWith('/api/')) {
		return; // let the network handle API + cross-origin
	}

	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(() => caches.match('/') as Promise<Response>));
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) => cached || fetch(request))
	);
});
