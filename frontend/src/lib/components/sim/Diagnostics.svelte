<script lang="ts">
	import { formatTimePs } from '../../engine/time';
	import type { Diagnostic } from '../../sim/diagnostics';

	interface Props {
		diagnostics: readonly Diagnostic[];
		onDismiss: (id: string) => void;
		onFocus: (componentIds: readonly string[]) => void;
		onLocateNet?: (nets: readonly string[]) => void;
	}

	let { diagnostics, onDismiss, onFocus, onLocateNet }: Props = $props();

	function kindLabel(diagnostic: Diagnostic): string {
		if (diagnostic.kind === 'compile-error') return 'compile error';
		if (diagnostic.kind === 'analog') return 'analysis';
		if (diagnostic.kind === 'timing') return 'timing';
		if (diagnostic.kind === 'event-limit') return 'event limit';
		return 'oscillation';
	}

	function windowLabel(diagnostic: Diagnostic): string {
		if (!diagnostic.window) return '';
		return `${formatTimePs(diagnostic.window.from)}–${formatTimePs(diagnostic.window.to)}`;
	}
</script>

{#if diagnostics.length > 0}
	<div class="diagnostics" role="status">
		{#each diagnostics as diagnostic (diagnostic.id)}
			<div
				class="entry"
				class:error={diagnostic.kind === 'compile-error' || diagnostic.kind === 'analog'}
				class:warning={diagnostic.kind === 'timing' ||
					diagnostic.kind === 'oscillation' ||
					diagnostic.kind === 'event-limit'}
			>
				<span class="kind">{kindLabel(diagnostic)}</span>
				<span class="message">{diagnostic.message}</span>
				{#if diagnostic.kind === 'timing' && diagnostic.window}
					<span class="window" data-testid="diagnostic-window">{windowLabel(diagnostic)}</span>
				{/if}
				{#if diagnostic.componentIds && diagnostic.componentIds.length > 0}
					<button
						type="button"
						onclick={() => onFocus(diagnostic.componentIds ?? [])}
					>
						Show components
					</button>
				{/if}
				{#if onLocateNet && diagnostic.nets && diagnostic.nets.length > 0}
					<button
						type="button"
						class="locate-net"
						onclick={() => onLocateNet?.(diagnostic.nets ?? [])}
					>
						Show net
					</button>
				{/if}
				<button type="button" class="dismiss" onclick={() => onDismiss(diagnostic.id)}>
					Dismiss
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.diagnostics {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12.5px;
	}

	.entry {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		padding: 7px 10px;
		background: var(--warn-soft);
		border: 1px solid #ecd49c;
		border-radius: var(--radius-sm);
		color: var(--ink);
	}

	.entry.error {
		background: var(--danger-soft);
		border-color: #e6b6b1;
	}

	.kind {
		font-size: 9.5px;
		font-weight: 650;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--warn);
		white-space: nowrap;
	}

	.entry.error .kind {
		color: var(--danger);
	}

	.message {
		flex: 1 1 auto;
		min-width: 0;
	}

	.window {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}

	.locate-net,
	.dismiss {
		padding: 2px 8px;
		min-height: 24px;
		font-size: 11px;
		background: var(--paper);
	}
</style>
