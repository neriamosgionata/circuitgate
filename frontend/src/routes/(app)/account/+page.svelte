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

<div class="account">
	<h1>Account</h1>
	<p class="muted">Signed in as {data.user.email}</p>

	<section class="card">
		<h2>Change password</h2>
		<form onsubmit={submitChange} novalidate>
			<label>
				<span>Current password</span>
				<input type="password" bind:value={currentPassword} autocomplete="current-password" />
			</label>
			<label>
				<span>New password</span>
				<input type="password" bind:value={newPassword} autocomplete="new-password" />
			</label>
			<label>
				<span>Confirm new password</span>
				<input type="password" bind:value={confirmPassword} autocomplete="new-password" />
			</label>
			{#if changeError}<p class="error" role="alert">{changeError}</p>{/if}
			{#if changeMessage}<p class="success" role="status">{changeMessage}</p>{/if}
			<button type="submit" class="primary" data-testid="change-password" disabled={changing}>
				{changing ? 'Saving…' : 'Change password'}
			</button>
		</form>
	</section>

	<section class="card">
		<h2>Sessions</h2>
		<p class="muted">End every session for this account, including this one.</p>
		{#if confirmingLogoutAll}
			<div class="confirm">
				<span>End all sessions?</span>
				<button type="button" data-testid="logout-all-confirm" onclick={confirmLogoutAll} disabled={loggingOutAll}>
					{loggingOutAll ? 'Ending…' : 'Yes, log out everywhere'}
				</button>
				<button type="button" onclick={() => (confirmingLogoutAll = false)}>Cancel</button>
			</div>
		{:else}
			<button type="button" class="danger" data-testid="logout-all" onclick={() => (confirmingLogoutAll = true)}>
				Log out all devices
			</button>
		{/if}
		{#if logoutError}<p class="error" role="alert">{logoutError}</p>{/if}
	</section>
</div>

<style>
	.account {
		flex: 1;
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
		padding: 18px clamp(14px, 4vw, 36px) 30px;
		overflow: auto;
	}

	h1 {
		margin: 0;
		font-size: 30px;
		color: var(--ink);
	}

	.muted {
		color: var(--ink-soft);
		font-size: 13px;
	}

	.card {
		max-width: 460px;
		margin-top: 16px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		box-shadow: var(--shadow-sheet);
		overflow: hidden;
	}

	.card h2 {
		margin: 0;
		padding: 8px 16px;
		border-bottom: var(--rule-hair);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.35), transparent);
		font-size: 16px;
		color: var(--ink);
	}

	.card form,
	.card .confirm,
	.card .muted {
		padding: 12px 16px 16px;
	}

	.card .muted {
		margin: 0;
		padding-bottom: 0;
	}

	.card form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.card label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--ink-soft);
	}

	.card label span {
		font-family: var(--font-head);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	input[type='password'] {
		font-family: var(--font-mono);
	}

	.error {
		margin: 0;
		padding: 8px;
		border: 2px solid var(--stamp-red);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-red);
		font-size: 13px;
	}

	.success {
		margin: 0;
		padding: 8px;
		border: 2px solid var(--stamp-green);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-green);
		font-size: 13px;
	}

	.confirm {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
</style>
