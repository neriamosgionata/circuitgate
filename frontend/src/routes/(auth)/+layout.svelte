<script lang="ts">
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="auth-shell">
	<main class="auth-card">
		<a class="brand" href="/">CircuitGate</a>
		{@render children()}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
	}

	.auth-shell {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: #eceff1;
	}

	.auth-card {
		width: min(420px, 100%);
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 28px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 8px;
		box-shadow: 0 2px 10px rgba(38, 50, 56, 0.08);
	}

	.brand {
		font-size: 20px;
		font-weight: 700;
		color: #263238;
		text-decoration: none;
	}
</style>
