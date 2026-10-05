<script lang="ts">
	import { goto } from '$app/navigation';
	import { logout } from '#lib/api/auth';
	import { apiErrorMessage } from '#lib/api/client';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let signingOut = $state(false);
	let error = $state<string | null>(null);

	async function signOut() {
		error = null;
		signingOut = true;
		try {
			await logout();
			await goto('/login');
		} catch (cause) {
			error = apiErrorMessage(cause);
		} finally {
			signingOut = false;
		}
	}
</script>

<header class="app-nav">
	<a class="brand" href="/projects">CircuitGate</a>
	<nav>
		<a href="/projects">Projects</a>
		<a href="/teams">Teams</a>
		<a href="/account">Account</a>
		<span class="email" title={data.user.email}>{data.user.email}</span>
		<button type="button" data-testid="logout" onclick={signOut} disabled={signingOut}>Log out</button>
	</nav>
</header>
{#if error}<p class="nav-error" role="alert">{error}</p>{/if}
<main class="app-content">
	{@render children()}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
	}

	.app-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 8px 16px;
		background: #263238;
		color: #eceff1;
	}

	.brand {
		font-weight: 700;
		color: #ffffff;
		text-decoration: none;
	}

	nav {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 13px;
	}

	nav a {
		color: #cfd8dc;
		text-decoration: none;
	}

	nav a:hover {
		color: #ffffff;
	}

	.email {
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #90a4ae;
	}

	button {
		padding: 5px 10px;
		border: 1px solid #546e7a;
		border-radius: 4px;
		background: transparent;
		color: #eceff1;
		font-size: 13px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.nav-error {
		margin: 0;
		padding: 6px 16px;
		background: #ffebee;
		color: #b71c1c;
		font-size: 13px;
	}

	.app-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
</style>
