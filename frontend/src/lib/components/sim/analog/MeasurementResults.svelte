<script lang="ts">
	import {
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
				data-value={outcome.status === 'complete' && outcome.type !== 'minmax' ? String(outcome.value) : ''}
				data-min={outcome.min === undefined ? '' : String(outcome.min)}
				data-max={outcome.max === undefined ? '' : String(outcome.max)}
			>
				<div class="head">
					<span class="type">{outcome.type}</span>
					<span class="name">{outcome.name}</span>
					<span class="signal">{outcome.signal}</span>
					<span class="value">{valueText(outcome)}</span>
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
		flex: 1;
		min-height: 100px;
	}

	.measurement {
		border: 1px solid #cfd8dc;
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
	}

	.measurement.failed {
		background: #fff8e1;
		border-color: #ffcc80;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}

	.type {
		font-weight: 700;
		text-transform: uppercase;
		font-size: 10px;
	}

	.name {
		font-weight: 600;
	}

	.signal {
		color: #607d8b;
	}

	.value {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}

	.samples {
		display: block;
		color: #90a4ae;
		font-size: 11px;
		margin-top: 2px;
	}

	.diagnostic {
		margin-top: 4px;
		color: #b71c1c;
	}

	.empty {
		font-size: 12px;
		color: #90a4ae;
		margin: 12px 0;
	}
</style>
