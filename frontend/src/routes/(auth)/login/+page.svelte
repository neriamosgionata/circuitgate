<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { login } from '#lib/api/auth';
	import { authErrorMessage, safeRedirectTarget } from '#lib/api/client';

	let email = $state('');
	let password = $state('');
	let rememberMe = $state(false);
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let fieldErrors = $state<{ email?: string; password?: string }>({});

	function validate(): boolean {
		const next: { email?: string; password?: string } = {};
		if (email.trim().length === 0) next.email = 'Enter your email address.';
		else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
		if (password.length === 0) next.password = 'Enter your password.';
		fieldErrors = next;
		return Object.keys(next).length === 0;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		if (!validate()) return;
		submitting = true;
		try {
			await login(email.trim(), password, rememberMe);
			await goto(safeRedirectTarget(page.url.searchParams.get('redirectTo')));
		} catch (cause) {
			error = authErrorMessage(cause);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in · CircuitGate</title>
</svelte:head>

<h1>Sign in</h1>

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
			autocomplete="current-password"
			bind:value={password}
			aria-invalid={fieldErrors.password ? 'true' : undefined}
		/>
	</label>
	{#if fieldErrors.password}<p class="field-error">{fieldErrors.password}</p>{/if}
	<label class="checkbox">
		<input type="checkbox" bind:checked={rememberMe} />
		<span>Remember me</span>
	</label>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
</form>

<p class="secondary">
	<a href="/reset">Forgot your password?</a>
	<span> · </span>
	<a href="/register">Create an account</a>
</p>

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

	.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 8px;
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

	.secondary {
		margin: 0;
		font-size: 13px;
		color: #607d8b;
	}
</style>
