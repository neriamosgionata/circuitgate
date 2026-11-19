<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { logout } from '#lib/api/auth';
	import { apiErrorMessage } from '#lib/api/client';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let signingOut = $state(false);
	let error = $state<string | null>(null);

	const initials = $derived(
		data.user.email
			.split('@')[0]
			.replace(/[^a-z0-9]+/gi, ' ')
			.trim()
			.slice(0, 2)
			.toUpperCase() || 'CG'
	);

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

<a class="skip-link" href="#main-content">Skip to content</a>

<div class="shell">
	<aside class="rail">
		<a class="brand" href="/projects" aria-label="CircuitGate projects">
			<svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
				<path d="M4 8h6l4 6h9" />
				<path d="M4 20h6l4-6" />
				<rect x="1" y="5" width="5" height="5" rx="1" />
				<rect x="1" y="17" width="5" height="5" rx="1" />
				<circle cx="23" cy="14" r="2.4" />
			</svg>
			<span class="brand-copy">
				<span class="brand-name">CircuitGate</span>
				<span class="brand-sub">logic + analog</span>
			</span>
		</a>

		<nav aria-label="Primary">
			<a href="/projects" aria-label="Projects" class:active={page.url.pathname === '/projects'} aria-current={page.url.pathname === '/projects' ? 'page' : undefined}>
				<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
					<rect x="2.5" y="2.5" width="6" height="6" />
					<rect x="11.5" y="2.5" width="6" height="6" />
					<rect x="2.5" y="11.5" width="6" height="6" />
					<path d="M11.5 14.5h6M14.5 11.5v6" />
				</svg>
				<span>Projects</span>
			</a>
			<a href="/teams" aria-label="Teams" class:active={page.url.pathname === '/teams'} aria-current={page.url.pathname === '/teams' ? 'page' : undefined}>
				<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
					<circle cx="7.2" cy="6.6" r="2.9" />
					<path d="M2.2 17c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6" />
					<path d="M13.4 4.1a2.9 2.9 0 0 1 0 5.6M14.6 12.7c2 .5 3.2 2.1 3.2 4.3" />
				</svg>
				<span>Teams</span>
			</a>
			<a href="/account" aria-label="Account" class:active={page.url.pathname === '/account'} aria-current={page.url.pathname === '/account' ? 'page' : undefined}>
				<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
					<circle cx="10" cy="10" r="7.4" />
					<circle cx="10" cy="7.8" r="2.6" />
					<path d="M5.4 16.2c.7-2.3 2.4-3.5 4.6-3.5s3.9 1.2 4.6 3.5" />
				</svg>
				<span>Account</span>
			</a>
		</nav>

		<div class="rail-foot">
			<span class="avatar" aria-hidden="true">{initials}</span>
			<span class="identity">
				<span class="email" title={data.user.email}>{data.user.email}</span>
				<span class="session-state">Signed in</span>
			</span>
			<button type="button" data-testid="logout" onclick={signOut} disabled={signingOut}>
				{signingOut ? 'Signing out…' : 'Log out'}
			</button>
		</div>
	</aside>

	<div class="viewport">
		{#if error}<p class="nav-error" role="alert">{error}</p>{/if}
		<main id="main-content" class="app-content">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.skip-link {
		position: absolute;
		left: 12px;
		top: -60px;
		z-index: 60;
		padding: 9px 14px;
		background: var(--paper);
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		font-weight: 600;
		text-decoration: none;
	}

	.skip-link:focus {
		top: 12px;
	}

	.shell {
		display: flex;
		height: 100dvh;
		min-height: 100dvh;
		overflow: hidden;
	}

	.rail {
		position: sticky;
		top: 0;
		display: flex;
		flex-direction: column;
		align-self: flex-start;
		width: 224px;
		flex: none;
		height: 100dvh;
		padding: 18px 12px 14px;
		background: var(--shell);
		color: var(--shell-ink);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 10px 18px;
		color: var(--shell-ink);
		text-decoration: none;
		border-bottom: 1px solid var(--shell-line);
		margin-bottom: 14px;
	}

	.brand-mark {
		width: 26px;
		height: 26px;
		flex: none;
		fill: none;
		stroke: var(--shell-ink);
		stroke-width: 1.7;
	}

	.brand-mark circle {
		fill: #6ea8ff;
		stroke: #6ea8ff;
	}

	.brand-copy {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
		min-width: 0;
	}

	.brand-name {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.brand-sub {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--shell-soft);
		margin-top: 3px;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	nav a {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border-radius: var(--radius-sm);
		color: var(--shell-soft);
		font-size: 13.5px;
		font-weight: 550;
		text-decoration: none;
		transition:
			background-color 120ms linear,
			color 120ms linear;
	}

	nav a svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}

	nav a:hover {
		background: var(--shell-raised);
		color: var(--shell-ink);
	}

	nav a.active {
		background: var(--accent);
		color: #fff;
	}

	nav a:focus-visible,
	.rail-foot button:focus-visible,
	.brand:focus-visible {
		outline: 2px solid #cfe0ee;
		outline-offset: 2px;
	}

	.rail-foot {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: auto;
		padding: 12px 8px 0;
		border-top: 1px solid var(--shell-line);
		min-width: 0;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		flex: none;
		border-radius: var(--radius-sm);
		background: var(--shell-raised);
		border: 1px solid var(--shell-line);
		color: #cfe0ee;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
	}

	.identity {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.2;
	}

	.email {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--shell-ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100px;
	}

	.session-state {
		font-size: 10px;
		color: var(--shell-soft);
		margin-top: 2px;
	}

	.rail-foot button {
		margin-left: auto;
		min-height: 30px;
		padding: 5px 9px;
		font-size: 11px;
		background: transparent;
		border-color: var(--shell-line);
		color: var(--shell-soft);
	}

	.rail-foot button:hover:not(:disabled) {
		background: var(--shell-raised);
		border-color: var(--shell-soft);
		color: var(--shell-ink);
	}

	.viewport {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 100dvh;
	}

	.app-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
	}

	.nav-error {
		margin: 0;
		padding: 9px 20px;
		background: var(--danger-soft);
		border-bottom: 1px solid #e6b6b1;
		color: #8f1f16;
		font-size: 13px;
	}

	@media (max-width: 900px) {
		.shell {
			flex-direction: column;
		}

		.rail {
			position: sticky;
			z-index: 30;
			width: 100%;
			height: auto;
			flex-direction: row;
			align-items: center;
			gap: 10px;
			padding: 8px 12px;
			border-bottom: 1px solid var(--shell-line);
		}

		.brand {
			padding: 0 12px 0 2px;
			margin: 0;
			border-bottom: 0;
			border-right: 1px solid var(--shell-line);
		}

		.brand-sub {
			display: none;
		}

		nav {
			flex-direction: row;
			gap: 2px;
			min-width: 0;
			overflow-x: auto;
		}

		nav a {
			padding: 7px 10px;
		}

		.rail-foot {
			margin: 0 0 0 auto;
			padding: 0;
			border-top: 0;
		}

		.identity {
			display: none;
		}

		.rail-foot button {
			margin: 0;
		}

		.viewport {
			min-height: 0;
		}
	}

	@media (max-width: 560px) {
		nav a {
			gap: 0;
			padding: 8px;
		}

		nav a span {
			display: none;
		}

		.avatar {
			display: none;
		}
	}
</style>
