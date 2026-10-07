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
		font-size: 13px;
		color: var(--ink);
	}

	.op table {
		width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.op th,
	.op td {
		padding: 3px 8px 3px 0;
		text-align: left;
		border-bottom: var(--rule-faint);
	}

	.op th {
		font-family: var(--font-head);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.signal {
		color: var(--ink);
	}

	.value {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.kind {
		color: var(--ink-soft);
		font-size: 11px;
	}

	.empty {
		color: var(--ink-soft);
		font-size: 13px;
		margin: 4px 0;
	}
</style>
