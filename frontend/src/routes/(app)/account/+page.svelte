<script lang="ts">
	import { goto } from '$app/navigation';
	import { changePassword, logoutAll } from '#lib/api/auth';
	import { apiErrorMessage, authErrorMessage } from '#lib/api/client';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let changing = $state(false);
	let changeMessage = $state<string | null>(null);
	let changeError = $state<string | null>(null);

	let confirmingLogoutAll = $state(false);
	let loggingOutAll = $state(false);
	let logoutError = $state<string | null>(null);

	async function submitChange(event: SubmitEvent) {
		event.preventDefault();
		changeMessage = null;
		changeError = null;
		if (newPassword.length < 8) {
			changeError = 'Use at least 8 characters for the new password.';
			return;
		}
		if (newPassword !== confirmPassword) {
			changeError = 'New passwords do not match.';
			return;
		}
		changing = true;
		try {
			await changePassword(currentPassword, newPassword);
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			changeMessage = 'Password changed. Other sessions have been signed out.';
		} catch (cause) {
			changeError = authErrorMessage(cause);
		} finally {
			changing = false;
		}
	}

	async function confirmLogoutAll() {
		loggingOutAll = true;
		logoutError = null;
		try {
			await logoutAll();
			await goto('/login');
		} catch (cause) {
			logoutError = apiErrorMessage(cause);
			loggingOutAll = false;
		}
	}
</script>

<svelte:head>
	<title>Account · CircuitGate</title>
</svelte:head>

<div class="page-frame">
	<header class="page-head">
		<div class="identity">
			<span class="monogram" aria-hidden="true">{data.user.email.slice(0, 2).toUpperCase()}</span>
			<div>
				<h1>Account</h1>
				<p class="email">{data.user.email}</p>
			</div>
		</div>
		<span class="stamp" class:is-muted={!data.user.verified}>
			{data.user.verified ? 'verified' : 'unverified'}
		</span>
	</header>

	<div class="panels">
		<section class="sheet" aria-labelledby="password-heading">
			<div class="sheet-head">
				<h2 id="password-heading">Change password</h2>
			</div>
			<form onsubmit={submitChange} novalidate>
				<label class="field">
					<span>Current password</span>
					<input type="password" bind:value={currentPassword} autocomplete="current-password" />
				</label>
				<label class="field">
					<span>New password</span>
					<input type="password" bind:value={newPassword} autocomplete="new-password" />
				</label>
				<label class="field">
					<span>Confirm new password</span>
					<input type="password" bind:value={confirmPassword} autocomplete="new-password" />
				</label>
				<p class="hint">At least 8 characters. Other sessions are signed out when this succeeds.</p>
				{#if changeError}<p class="error" role="alert">{changeError}</p>{/if}
				{#if changeMessage}<p class="success" role="status">{changeMessage}</p>{/if}
				<button type="submit" class="primary" data-testid="change-password" disabled={changing}>
					{changing ? 'Saving…' : 'Change password'}
				</button>
			</form>
		</section>

		<section class="sheet" aria-labelledby="sessions-heading">
			<div class="sheet-head">
				<h2 id="sessions-heading">Sessions</h2>
			</div>
			<div class="session-body">
				<p class="muted">
					End every session for this account, including the one on this device. You will need to sign
					in again.
				</p>
				{#if confirmingLogoutAll}
					<div class="confirm" role="group" aria-label="Confirm ending all sessions">
						<span>End all sessions?</span>
						<button
							type="button"
							class="danger"
							data-testid="logout-all-confirm"
							onclick={confirmLogoutAll}
							disabled={loggingOutAll}
						>
							{loggingOutAll ? 'Ending…' : 'Yes, log out everywhere'}
						</button>
						<button type="button" onclick={() => (confirmingLogoutAll = false)}>Cancel</button>
					</div>
				{:else}
					<button
						type="button"
						class="danger"
						data-testid="logout-all"
						onclick={() => (confirmingLogoutAll = true)}
					>
						Log out all devices
					</button>
				{/if}
				{#if logoutError}<p class="error" role="alert">{logoutError}</p>{/if}
			</div>
		</section>
	</div>
</div>

<style>
	.page-head {
		margin-bottom: 22px;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.monogram {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		flex: none;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-family: var(--font-ui);
		font-size: 15px;
		font-weight: 650;
		letter-spacing: 0.03em;
		border: 1px solid var(--accent-line);
		border-radius: var(--radius-md);
	}

	.page-head h1 {
		margin: 0;
	}

	.email {
		margin: 3px 0 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
		overflow-wrap: anywhere;
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 20px;
		align-items: start;
	}

	.sheet {
		overflow: hidden;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.hint {
		margin: 0;
		font-size: 12px;
		color: var(--ink-soft);
	}

	.session-body {
		padding: 16px;
	}

	.session-body > .muted {
		margin: 0 0 14px;
		max-width: 46ch;
		font-size: 13.5px;
	}

	.confirm {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 13px;
	}
</style>
