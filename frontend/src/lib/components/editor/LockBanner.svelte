<script lang="ts">
	interface Props {
		role: 'acquiring' | 'holder' | 'waiting' | 'lost' | 'free';
		holderEmail?: string | null;
		busy?: boolean;
		onAcquire?: () => void;
		onRelease?: () => void;
	}

	let { role, holderEmail = null, busy = false, onAcquire, onRelease }: Props = $props();
</script>

<div
	class="lock-banner"
	class:locked={role === 'waiting' || role === 'lost'}
	data-testid="lock-banner"
	data-role={role}
>
	{#if role === 'holder'}
		<span data-testid="lock-holder">Editing — you hold the lock.</span>
		<button type="button" data-testid="lock-release" onclick={onRelease} disabled={busy}>
			Release lock
		</button>
	{:else if role === 'waiting'}
		<span data-testid="lock-busy">
			Read-only — {holderEmail ? `${holderEmail} is editing this project.` : 'Another editor holds the lock.'}
			Waiting to take over.
		</span>
	{:else if role === 'lost'}
		<span data-testid="lock-lost">
			Read-only — your edit lock was lost. Your draft is kept locally.
		</span>
		{#if onAcquire}
			<button type="button" data-testid="lock-acquire" onclick={onAcquire} disabled={busy}>
				{busy ? 'Trying…' : 'Try to edit again'}
			</button>
		{/if}
	{:else if role === 'free'}
		<span data-testid="lock-free">No one is editing this project.</span>
		<button type="button" data-testid="lock-acquire" onclick={onAcquire} disabled={busy}>
			{busy ? 'Locking…' : 'Start editing'}
		</button>
	{:else}
		<span data-testid="lock-acquiring">Requesting the edit lock…</span>
	{/if}
</div>

<style>
	.lock-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		background: #e8f5e9;
		border-bottom: 1px solid #c8e6c9;
		font-size: 12px;
		color: #1b5e20;
	}

	.lock-banner.locked {
		background: #fff8e1;
		border-bottom-color: #ffe082;
		color: #6d4c00;
	}

	.lock-banner button {
		padding: 3px 8px;
		border: 1px solid #90a4ae;
		border-radius: 4px;
		background: #ffffff;
		font-size: 12px;
		cursor: pointer;
	}

	.lock-banner button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
