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
		<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create account'}</button>
	</form>
{/if}

<p class="secondary">Already registered? <a href="/login">Sign in</a></p>

<style>
	h1 {
		font-size: 24px;
		margin: 0;
		color: var(--ink);
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

	input[type='email'],
	input[type='password'] {
		font-family: var(--font-mono);
	}

	.notice {
		padding: 10px;
		border: 2px solid var(--stamp-green);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-green);
		font-size: 14px;
	}

	.notice p {
		margin: 0 0 6px;
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

	.field-error {
		margin: -6px 0 0;
		color: var(--stamp-red);
		font-size: 12px;
	}

	.secondary {
		margin: 0;
		font-size: 13px;
		color: var(--ink-soft);
	}
</style>
