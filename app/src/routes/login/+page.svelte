<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<svelte:head><title>Sign in — Logbook</title></svelte:head>

<div class="login-wrap">
	<div class="login-card">
		<div class="wordmark">log<span>book</span></div>
		<form method="POST" use:enhance>
			<input
				class="login-input"
				type="text"
				name="username"
				placeholder="Username"
				autocomplete="username"
				value={form?.username ?? ''}
				autocapitalize="off"
			/>
			<input
				class="login-input"
				type="password"
				name="password"
				placeholder="Password"
				autocomplete="current-password"
			/>
			{#if form?.error}
				<p class="login-error">{form.error}</p>
			{/if}
			<button class="btn btn-primary" type="submit">Sign in</button>
		</form>
	</div>
</div>

<style>
	.login-wrap {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 24px;
	}
	.login-card {
		width: 100%;
		max-width: 340px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.wordmark {
		font-weight: 800;
		font-size: 1.4rem;
		letter-spacing: -0.02em;
		text-align: center;
	}
	.wordmark span {
		color: var(--accent);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.login-input {
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		color: var(--text);
		padding: 14px 16px;
		font-size: 1rem;
	}
	.login-input::placeholder {
		color: var(--muted-2);
	}
	.login-error {
		color: var(--hot);
		font-size: 0.85rem;
		margin: 0;
		text-align: center;
	}
	.btn {
		margin-top: 4px;
		padding: 15px;
		border-radius: 14px;
		font-weight: 800;
		font-size: 1rem;
		border: none;
	}
	.btn-primary {
		background: var(--accent);
		color: #1a0f08;
	}
</style>
