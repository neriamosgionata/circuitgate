<script lang="ts">
	import { formatSI } from '../../../engine/analog/si';
	import type { AnalogResultVariable } from '../../../sim/analog/protocol';
	import { signalUnit, type AnalysisOutcome } from '../../../sim/analog/results';

	interface Props {
		outcome: AnalysisOutcome;
	}

	let { outcome }: Props = $props();

	function valueOf(variable: AnalogResultVariable): number {
		return variable.real[0];
	}

	const unitOf = (variable: AnalogResultVariable): string => signalUnit(variable);

	function categoryOf(variable: AnalogResultVariable): string {
		if (variable.type === 'current' || variable.name.startsWith('i(')) return 'branch current';
		return 'node voltage';
	}
</script>

<div class="op" data-testid="operating-point-view" data-analysis-id={outcome.analysisId}>
	{#if outcome.status !== 'complete'}
		<p class="empty" data-testid="op-empty">No operating-point numbers for this analysis.</p>
	{:else if outcome.variables.length === 0}
		<p class="empty" data-testid="op-empty">The operating point returned no values.</p>
	{:else}
		<table class="values" data-testid="operating-point-table">
			<thead>
				<tr>
					<th scope="col">Signal</th>
					<th scope="col">Value</th>
					<th scope="col">Kind</th>
				</tr>
			</thead>
			<tbody>
				{#each outcome.variables as variable (variable.name)}
					<tr
						data-testid="op-value-row"
						data-variable={variable.name}
						data-value={valueOf(variable)}
						data-kind={categoryOf(variable)}
					>
						<td class="signal">{variable.name}</td>
						<td class="value">{formatSI(valueOf(variable))}{unitOf(variable)}</td>
						<td class="kind">{categoryOf(variable)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.op {
		flex: 1;
		min-height: 120px;
	}

	.values {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}

	th {
		text-align: left;
		font-size: 10px;
		text-transform: uppercase;
		color: #607d8b;
		border-bottom: 1px solid #cfd8dc;
		padding: 4px 6px;
	}

	td {
		padding: 3px 6px;
		border-bottom: 1px solid #eceff1;
	}

	.signal {
		font-family: monospace;
	}

	.value {
		font-variant-numeric: tabular-nums;
	}

	.kind {
		color: #90a4ae;
		font-size: 11px;
	}

	.empty {
		font-size: 12px;
		color: #90a4ae;
		margin: 12px 0;
	}
</style>
