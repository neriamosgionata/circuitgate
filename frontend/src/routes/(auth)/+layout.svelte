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
	.auth-shell {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 28px 18px;
	}

	.auth-card {
		position: relative;
		width: min(430px, 100%);
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 30px 30px 26px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 3px;
		box-shadow: var(--shadow-sheet);
	}

	.auth-card::before,
	.auth-card::after {
		content: '';
		position: absolute;
		top: -14px;
		width: 74px;
		height: 30px;
		background: var(--tape);
		border-left: 1px dashed rgba(29, 29, 27, 0.22);
		border-right: 1px dashed rgba(29, 29, 27, 0.22);
		transform: rotate(-4deg);
		pointer-events: none;
	}

	.auth-card::before {
		left: 34px;
	}

	.auth-card::after {
		right: 34px;
		transform: rotate(5deg);
	}

	.brand {
		align-self: flex-start;
		width: fit-content;
		padding-bottom: 2px;
		border-bottom: 5px solid var(--highlight);
		font-family: var(--font-head);
		font-size: 20px;
		font-weight: 700;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--ink);
		text-decoration: none;
	}
</style>
