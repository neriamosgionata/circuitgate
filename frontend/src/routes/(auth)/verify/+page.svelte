<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resendVerification, verifyEmail } from '#lib/api/auth';
	import { authErrorMessage } from '#lib/api/client';

	type Status = 'verifying' | 'verified' | 'invalid' | 'failed';

	let status = $state<Status>('verifying');
	let verifyError = $state<string | null>(null);
	let resendEmail = $state('');
	let resendStatus = $state<string | null>(null);
	let resendError = $state<string | null>(null);
	let resending = $state(false);

	const token = page.url.searchParams.get('token') ?? '';

	onMount(async () => {
		if (token.length === 0) {
			status = 'invalid';
			verifyError = 'The verification link is missing its token.';
			return;
		}
		try {
			await verifyEmail(token);
			status = 'verified';
		} catch (cause) {
			status = 'invalid';
			verifyError = authErrorMessage(cause);
		}
	});

	async function resend(event: SubmitEvent) {
		event.preventDefault();
		resendStatus = null;
		resendError = null;
		if (resendEmail.trim().length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resendEmail.trim())) {
			resendError = 'Enter a valid email address.';
			return;
		}
		resending = true;
		try {
			await resendVerification(resendEmail.trim());
			resendStatus = 'A fresh verification link is on its way.';
		} catch (cause) {
			resendError = authErrorMessage(cause);
		} finally {
			resending = false;
		}
	}
</script>

<svelte:head>
	<title>Verify email · CircuitGate</title>
</svelte:head>

<h1>Verify email</h1>

{#if status === 'verifying'}
	<p role="status">Checking your verification link…</p>
{:else if status === 'verified'}
	<div class="notice" role="status">
		<p>Your email address is verified.</p>
		<p><a href="/login">Sign in</a></p>
	</div>
{:else}
	<div class="error" role="alert">
		<p>That verification link is invalid or has expired.</p>
		{#if verifyError}<p class="detail">{verifyError}</p>{/if}
	</div>
	<form onsubmit={resend}>
		<label>
			<span>Email</span>
			<input type="email" name="resend-email" bind:value={resendEmail} autocomplete="email" />
		</label>
		{#if resendError}<p class="field-error" role="alert">{resendError}</p>{/if}
		{#if resendStatus}<p class="success" role="status">{resendStatus}</p>{/if}
		<button type="submit" disabled={resending}>{resending ? 'Sending…' : 'Resend verification email'}</button>
	</form>
{/if}

<p class="secondary"><a href="/login">Back to sign in</a></p>

<style>
	h1 {
		font-size: 22px;
		margin: 0;
		color: #263238;
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

	input[type='email'] {
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

	.success {
		margin: 0;
		color: #1b5e20;
		font-size: 13px;
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
