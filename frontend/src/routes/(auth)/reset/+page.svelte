<script lang="ts">
	import { page } from '$app/state';
	import { requestPasswordReset, resetPassword } from '#lib/api/auth';
	import { authErrorMessage } from '#lib/api/client';

	type Stage = 'token' | 'request' | 'requested' | 'updated';

	const token = page.url.searchParams.get('token') ?? '';
	let stage = $state<Stage>(token.length > 0 ? 'token' : 'request');
	let tokenError = $state<string | null>(null);
	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let fieldErrors = $state<{ email?: string; password?: string; confirm?: string }>({});

	function validEmail(value: string): boolean {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
	}

	async function submitPassword(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		const next: { password?: string; confirm?: string } = {};
		if (password.length < 8) next.password = 'Use at least 8 characters.';
		if (confirm !== password) next.confirm = 'Passwords do not match.';
		fieldErrors = next;
		if (Object.keys(next).length > 0) return;
		submitting = true;
		try {
			await resetPassword(token, password);
			stage = 'updated';
		} catch (cause) {
			tokenError = authErrorMessage(cause);
			stage = 'request';
		} finally {
			submitting = false;
		}
	}

	async function submitRequest(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		const next: { email?: string } = {};
		if (!validEmail(email)) next.email = 'Enter a valid email address.';
		fieldErrors = next;
		if (Object.keys(next).length > 0) return;
		submitting = true;
		try {
			await requestPasswordReset(email.trim());
			stage = 'requested';
		} catch (cause) {
			error = authErrorMessage(cause);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Reset password · CircuitGate</title>
</svelte:head>

<h1>Reset password</h1>

{#if stage === 'token'}
	<p>Choose a new password for your account.</p>
	<form onsubmit={submitPassword} novalidate>
		<label>
			<span>New password</span>
			<input type="password" name="password" autocomplete="new-password" bind:value={password} />
		</label>
		{#if fieldErrors.password}<p class="field-error">{fieldErrors.password}</p>{/if}
		<label>
			<span>Confirm new password</span>
			<input type="password" name="confirm" autocomplete="new-password" bind:value={confirm} />
		</label>
		{#if fieldErrors.confirm}<p class="field-error">{fieldErrors.confirm}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Set new password'}</button>
	</form>
{:else if stage === 'request'}
	{#if tokenError}
		<div class="error" role="alert">
			<p>That reset link is invalid or has expired.</p>
			<p class="detail">{tokenError}</p>
		</div>
	{/if}
	<p>Enter your email address and we will send a reset link.</p>
	<form onsubmit={submitRequest} novalidate>
		<label>
			<span>Email</span>
			<input type="email" name="email" autocomplete="email" bind:value={email} />
		</label>
		{#if fieldErrors.email}<p class="field-error">{fieldErrors.email}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</button>
	</form>
{:else if stage === 'requested'}
	<div class="notice" role="status">
		<p>If an account exists for that address, a reset link is on its way.</p>
	</div>
{:else}
	<div class="notice" role="status">
		<p>Your password has been updated.</p>
		<p><a href="/login">Sign in</a></p>
	</div>
{/if}

{#if stage !== 'updated'}
	<p class="secondary"><a href="/login">Back to sign in</a></p>
{/if}

<style>
	h1 {
		font-size: 22px;
		margin: 0;
		color: #263238;
	}

	p {
		font-size: 14px;
		color: #455a64;
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

	input[type='email'],
	input[type='password'] {
		padding: 8px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 14px;
	}

	button {
		padding: 9px 12px;
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

	.error {
		padding: 12px;
		border-radius: 6px;
		background: #ffebee;
		color: #b71c1c;
		font-size: 14px;
	}

	.error p {
		margin: 0 0 4px;
	}

	.error .detail {
		font-size: 13px;
	}

	.field-error {
		margin: 0;
		color: #c62828;
		font-size: 12px;
	}

	.notice {
		padding: 12px;
		border-radius: 6px;
		background: #e8f5e9;
		color: #1b5e20;
		font-size: 14px;
	}

	.notice p {
		margin: 0 0 6px;
	}

	.secondary {
		margin: 0;
		font-size: 13px;
		color: #607d8b;
	}
</style>
