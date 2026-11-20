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
	<span class="dot" aria-hidden="true"></span>
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
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 7px 16px;
		background: var(--paper-soft);
		border-bottom: 1px solid var(--rule);
		font-size: 12.5px;
		color: var(--ink-soft);
	}

	.dot {
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 50%;
		background: var(--ink-faint);
	}

	.lock-banner[data-role='holder'] {
		background: var(--ok-soft);
		border-bottom-color: #b9dbc9;
		color: var(--ink);
	}

	.lock-banner[data-role='holder'] .dot {
		background: var(--ok);
	}

	.lock-banner.locked {
		background: var(--warn-soft);
		border-bottom-color: #ecd49c;
		color: var(--ink);
	}

	.lock-banner.locked .dot {
		background: var(--warn);
	}

	.lock-banner[data-role='lost'] {
		background: var(--danger-soft);
		border-bottom-color: #e6b6b1;
	}

	.lock-banner[data-role='lost'] .dot {
		background: var(--danger);
	}

	.lock-banner button {
		padding: 3px 9px;
		min-height: 26px;
		font-size: 11.5px;
		background: var(--paper);
	}
</style>
