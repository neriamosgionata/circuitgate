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
		<button type="submit" class="primary" disabled={resending}>{resending ? 'Sending…' : 'Resend verification email'}</button>
	</form>
{/if}

<p class="secondary"><a href="/login">Back to sign in</a></p>

<style>
	h1 {
		font-size: 24px;
		margin: 0;
		color: var(--ink);
	}

	p {
		font-size: 14px;
		color: var(--ink-soft);
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
		font-size: 12px;
		color: var(--ink-soft);
	}

	label span {
		font-family: var(--font-head);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	input[type='email'] {
		font-family: var(--font-mono);
	}

	.error {
		padding: 10px;
		border: 2px solid var(--stamp-red);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-red);
		font-size: 13px;
	}

	.field-error {
		margin: -6px 0 0;
		color: var(--stamp-red);
		font-size: 12px;
	}

	.success {
		margin: 0;
		padding: 10px;
		border: 2px solid var(--stamp-green);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-green);
		font-size: 13px;
	}

	.notice {
		padding: 10px;
		border: 2px solid var(--stamp-green);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-green);
		font-size: 14px;
	}

	.secondary {
		margin: 0;
		font-size: 13px;
		color: var(--ink-soft);
	}
</style>
