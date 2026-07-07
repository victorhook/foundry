<script lang="ts">
	import { onMount } from 'svelte';

	onMount(async () => {
		// Client-only: the module touches `document` and #app at import time.
		await import('$lib/logbook');
	});
</script>

<svelte:head><title>Logbook</title></svelte:head>

<div class="app" id="app"></div>
<div class="toast" id="toast"></div>
