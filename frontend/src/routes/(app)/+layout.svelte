<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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
		<a href="/projects" class:active={page.url.pathname === '/projects'}>Projects</a>
		<a href="/teams" class:active={page.url.pathname === '/teams'}>Teams</a>
		<a href="/account" class:active={page.url.pathname === '/account'}>Account</a>
		<span class="email" title={data.user.email}>{data.user.email}</span>
		<button type="button" data-testid="logout" onclick={signOut} disabled={signingOut}>Log out</button>
	</nav>
</header>
{#if error}<p class="nav-error" role="alert">{error}</p>{/if}
<main class="app-content">
	{@render children()}
</main>

<style>
	.app-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		row-gap: 4px;
		padding: 7px 16px;
		background: linear-gradient(180deg, var(--board-deep), #94805d);
		border-bottom: 2px solid var(--ink);
		color: var(--ink);
	}

	.brand {
		font-family: var(--font-head);
		font-weight: 700;
		font-size: 16px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink);
		text-decoration: none;
	}

	nav {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		row-gap: 4px;
	}

	nav a {
		padding: 4px 8px;
		border-bottom: 3px solid transparent;
		font-family: var(--font-head);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink);
		text-decoration: none;
	}

	nav a:hover {
		color: var(--ink);
		border-bottom-color: var(--highlight);
	}

	nav a.active {
		color: var(--ink);
		background: linear-gradient(180deg, transparent 56%, var(--highlight) 56%);
	}

	.email {
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	button {
		margin-left: 4px;
		white-space: nowrap;
	}

	.nav-error {
		margin: 0;
		padding: 6px 16px;
		background: var(--sheet);
		border-bottom: 2px solid var(--stamp-red);
		color: var(--stamp-red);
		font-size: 13px;
	}

	.app-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
</style>
