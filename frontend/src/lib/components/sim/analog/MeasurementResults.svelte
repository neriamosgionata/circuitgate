<script lang="ts">
import {
	measurementUnit,
	measurementValueText,
	type MeasurementOutcome
} from '../../../sim/analog/measurements';

	interface Props {
		outcomes: readonly MeasurementOutcome[];
		configured: number;
	}

	let { outcomes, configured }: Props = $props();

	function valueText(outcome: MeasurementOutcome): string {
		return measurementValueText(outcome);
	}
</script>

<div class="measurements" data-testid="measurement-results">
	{#if outcomes.length === 0}
		<p class="empty" data-testid="tab-empty">
			{configured === 0
				? 'Add a measurement definition, then run the circuit.'
				: 'Run the circuit to compute the configured measurements.'}
		</p>
	{:else}
		{#each outcomes as outcome (outcome.analysisId)}
			<div
				class="measurement"
				class:failed={outcome.status !== 'complete'}
				data-testid="measurement-result"
				data-analysis-id={outcome.analysisId}
				data-status={outcome.status}
				data-name={outcome.name}
				data-type={outcome.type}
				data-unit={measurementUnit(outcome.type, outcome.signal)}
				data-value={outcome.status === 'complete' && outcome.type !== 'minmax' ? String(outcome.value) : ''}
				data-min={outcome.min === undefined ? '' : String(outcome.min)}
				data-max={outcome.max === undefined ? '' : String(outcome.max)}
			>
				<div class="head">
					<span class="type">{outcome.type}</span>
					<span class="name">{outcome.name}</span>
					<span class="signal">{outcome.signal}</span>
					<span class="value">{valueText(outcome)}</span>
					{#if measurementUnit(outcome.type, outcome.signal) !== ''}
						<span class="unit" data-testid="measurement-unit">
							{measurementUnit(outcome.type, outcome.signal)}
						</span>
					{/if}
				</div>
				{#if outcome.status === 'complete' && outcome.samples !== undefined}
					<span class="samples" data-testid="measurement-samples">
						{outcome.samples} samples
					</span>
				{/if}
				{#if outcome.diagnostic}
					<div class="diagnostic" data-testid="analysis-result-diagnostic">
						{outcome.diagnostic.message}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.measurements {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: var(--ink);
	}

	.measurement {
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--paper);
		padding: 8px 10px;
	}

	.measurement.failed {
		border-color: #e6b6b1;
		background: var(--danger-soft);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
	}

	.type {
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.name {
		font-weight: 600;
	}

	.signal {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	.value {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	.unit {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	.samples {
		display: block;
		color: var(--ink-soft);
		font-size: 11px;
		font-family: var(--font-mono);
		margin-top: 2px;
	}

	.diagnostic {
		margin-top: 4px;
		color: var(--stamp-red);
		font-size: 12px;
	}

	.empty {
		font-size: 13px;
		color: var(--ink-soft);
	}
</style>
