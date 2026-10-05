<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} · CircuitGate</title>
</svelte:head>

<main class="error-page">
	<h1>{page.status}</h1>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	<a href="/projects">Back to projects</a>
</main>

<style>
	.error-page {
		max-width: 480px;
		margin: 80px auto;
		padding: 24px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 8px;
		text-align: center;
		font-family: system-ui, sans-serif;
		color: #263238;
	}

	h1 {
		margin: 0 0 8px;
		font-size: 40px;
		color: #546e7a;
	}

	p {
		margin: 0 0 20px;
	}
</style>
