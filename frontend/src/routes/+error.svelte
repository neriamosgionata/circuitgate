<script lang="ts">
	import { page } from '$app/state';

	const message = $derived(
		page.error?.message ?? (page.status === 404 ? 'Not found.' : 'The page could not be loaded.')
	);
</script>

<svelte:head>
	<title>{page.status} · CircuitGate</title>
</svelte:head>

<main class="error-page">
	<div class="sheet error-sheet">
		<span class="stamp is-void">{page.status}</span>
		<h1>{page.status === 404 ? 'Sheet not found' : 'Something went wrong'}</h1>
		<p>{message}</p>
		<p class="hint">
			{page.status === 404
				? 'Check the address, or open your projects to find the sheet.'
				: 'Try again, or return to your projects.'}
		</p>
		<a class="button primary" href="/projects">Back to projects</a>
	</div>
</main>

<style>
	.error-page {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 28px 18px;
	}

	.error-sheet {
		width: min(480px, 100%);
		padding: 28px;
	}

	.stamp {
		margin-bottom: 12px;
	}

	h1 {
		margin: 0 0 8px;
		font-size: clamp(26px, 3vw, 32px);
	}

	p {
		margin: 0 0 8px;
		color: var(--ink-soft);
		max-width: 46ch;
	}

	.hint {
		margin-bottom: 22px;
		font-size: 13px;
		color: var(--ink-faint);
	}

	.button {
		text-decoration: none;
	}
</style>
