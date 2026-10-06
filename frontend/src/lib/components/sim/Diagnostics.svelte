<script lang="ts">
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
		return 'oscillation';
	}
</script>

{#if diagnostics.length > 0}
	<div class="diagnostics" role="status">
		{#each diagnostics as diagnostic (diagnostic.id)}
			<div class="entry" class:error={diagnostic.kind === 'compile-error'}>
				<span class="kind">{kindLabel(diagnostic)}</span>
				<span class="message">{diagnostic.message}</span>
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
		gap: 4px;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		font-size: 12px;
		border: 1px solid #ffcc80;
		border-radius: 4px;
		background: #fff8e1;
		color: #6d4c41;
	}

	.entry.error {
		border-color: #ef9a9a;
		background: #ffebee;
		color: #b71c1c;
	}

	.kind {
		font-size: 10px;
		text-transform: uppercase;
		font-weight: 700;
	}

	.message {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	button {
		font-size: 11px;
		padding: 2px 6px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		background: #ffffff;
		cursor: pointer;
	}
</style>
