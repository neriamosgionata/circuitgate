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
		gap: 6px;
		font-size: 13px;
	}

	.entry {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
		padding: 6px 8px;
		background: var(--sheet-raised);
		border: 2px solid var(--stamp-red);
		border-radius: 2px;
		color: var(--ink);
	}

	.kind {
		font-family: var(--font-head);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--stamp-red);
	}

	.message {
		flex: 1 1 auto;
	}

	.locate-net,
	.dismiss {
		padding: 2px 7px;
		font-size: 11px;
	}
</style>
