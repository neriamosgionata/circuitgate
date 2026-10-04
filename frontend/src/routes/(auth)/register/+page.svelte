<script lang="ts">
	import { register } from '#lib/api/auth';
	import { authErrorMessage } from '#lib/api/client';

	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let submitting = $state(false);
	let sent = $state(false);
	let error = $state<string | null>(null);
	let fieldErrors = $state<{ email?: string; password?: string; confirm?: string }>({});

	function validate(): boolean {
		const next: { email?: string; password?: string; confirm?: string } = {};
		if (email.trim().length === 0) next.email = 'Enter your email address.';
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
		if (password.length < 8) next.password = 'Use at least 8 characters.';
		if (confirm !== password) next.confirm = 'Passwords do not match.';
		fieldErrors = next;
		return Object.keys(next).length === 0;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		if (!validate()) return;
		submitting = true;
		try {
			await register(email.trim(), password);
			sent = true;
		} catch (cause) {
			error = authErrorMessage(cause);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Create account · CircuitGate</title>
</svelte:head>

<h1>Create account</h1>

{#if sent}
	<div class="notice" role="status">
		<p>Check your inbox for a verification link, then sign in.</p>
		<p><a href="/login">Go to sign in</a></p>
	</div>
{:else}
	<form onsubmit={submit} novalidate>
		<label>
			<span>Email</span>
			<input
				type="email"
				name="email"
				autocomplete="email"
				bind:value={email}
				aria-invalid={fieldErrors.email ? 'true' : undefined}
			/>
		</label>
		{#if fieldErrors.email}<p class="field-error">{fieldErrors.email}</p>{/if}
		<label>
			<span>Password</span>
			<input
				type="password"
				name="password"
				autocomplete="new-password"
				bind:value={password}
				aria-invalid={fieldErrors.password ? 'true' : undefined}
			/>
		</label>
		{#if fieldErrors.password}<p class="field-error">{fieldErrors.password}</p>{/if}
		<label>
			<span>Confirm password</span>
			<input
				type="password"
				name="confirm"
				autocomplete="new-password"
				bind:value={confirm}
				aria-invalid={fieldErrors.confirm ? 'true' : undefined}
			/>
		</label>
		{#if fieldErrors.confirm}<p class="field-error">{fieldErrors.confirm}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create account'}</button>
	</form>
{/if}

<p class="secondary">Already registered? <a href="/login">Sign in</a></p>

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

	input[type='email'],
	input[type='password'] {
		padding: 8px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 14px;
	}

	button[type='submit'] {
		padding: 9px 12px;
		border: none;
		border-radius: 4px;
		background: #1565c0;
		color: #ffffff;
		font-size: 14px;
		cursor: pointer;
	}

	button[type='submit']:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.error {
		margin: 0;
		padding: 8px;
		border-radius: 4px;
		background: #ffebee;
		color: #b71c1c;
		font-size: 13px;
	}

	.field-error {
		margin: -6px 0 0;
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
