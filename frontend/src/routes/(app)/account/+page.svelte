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
			<button type="submit" data-testid="change-password" disabled={changing}>
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
			<button type="button" data-testid="logout-all" onclick={() => (confirmingLogoutAll = true)}>
				Log out all devices
			</button>
		{/if}
		{#if logoutError}<p class="error" role="alert">{logoutError}</p>{/if}
	</section>
</div>

<style>
	.account {
		flex: 1;
		padding: 20px;
		background: #eceff1;
		overflow: auto;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		color: #263238;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 16px;
		color: #37474f;
	}

	.muted {
		color: #607d8b;
		font-size: 13px;
	}

	.card {
		max-width: 440px;
		margin-top: 16px;
		padding: 16px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: #455a64;
	}

	input[type='password'] {
		padding: 8px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 14px;
	}

	button {
		align-self: flex-start;
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		background: #1565c0;
		color: #ffffff;
		font-size: 14px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.confirm {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		color: #455a64;
	}

	.error {
		margin: 0;
		padding: 8px;
		border-radius: 4px;
		background: #ffebee;
		color: #b71c1c;
		font-size: 13px;
	}

	.success {
		margin: 0;
		padding: 8px;
		border-radius: 4px;
		background: #e8f5e9;
		color: #1b5e20;
		font-size: 13px;
	}
</style>
