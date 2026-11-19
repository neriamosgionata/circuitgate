<script lang="ts">
	import { formatTimePs } from '../../engine/time';
	import type { SimulationMode, SimulationPauseReason } from '../../sim/protocol';

	interface Props {
		mode: SimulationMode;
		running: boolean;
		tick: number;
		ready: boolean;
		pauseReason?: SimulationPauseReason | null;
		onRun: () => void;
		onPause: () => void;
		onStep: () => void;
		onReset: () => void;
		onModeChange: (mode: SimulationMode) => void;
	}

	let {
		mode,
		running,
		tick,
		ready,
		pauseReason = null,
		onRun,
		onPause,
		onStep,
		onReset,
		onModeChange
	}: Props = $props();

	const timeLabel = $derived(mode === 'physical' ? formatTimePs(tick) : `tick ${tick}`);
	const eventLimited = $derived(pauseReason === 'event-limit');
	const pauseLabel = $derived(
		pauseReason === 'timing'
			? 'paused: timing violation'
			: pauseReason === 'event-limit'
				? 'paused: event limit — reset to continue'
				: ''
	);
</script>

<div class="controls">
	<button type="button" onclick={onRun} disabled={!ready || running || eventLimited}>Run</button>
	<button type="button" onclick={onPause} disabled={!ready || !running}>Pause</button>
	<button type="button" onclick={onStep} disabled={!ready || running || eventLimited}>Step</button>
	<button type="button" onclick={onReset} disabled={!ready}>Reset</button>
	<label>
		<span>Mode</span>
		<select
			data-testid="simulation-mode"
			value={mode}
			disabled={running}
			onchange={(event) => {
				const next = event.currentTarget.value;
				onModeChange(next === 'timed' ? 'timed' : next === 'physical' ? 'physical' : 'delta');
			}}
		>
			<option value="delta">delta-cycle</option>
			<option value="timed">timed</option>
			<option value="physical">physical timing</option>
		</select>
	</label>
	<span class="tick" data-testid="sim-time">{timeLabel}</span>
	{#if running}
		<span class="running">running</span>
	{/if}
	{#if pauseLabel}
		<span class="pause" data-testid="sim-pause-reason">{pauseLabel}</span>
	{/if}
</div>

<style>
	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
	}

	button {
		font-size: 12px;
		padding: 4px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		background: #f5f7f8;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: #546e7a;
	}

	select {
		font-size: 12px;
		padding: 3px 4px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
	}

	.tick {
		font-size: 12px;
		color: #37474f;
		font-variant-numeric: tabular-nums;
	}

	.running {
		font-size: 11px;
		color: #2e7d32;
	}

	.pause {
		font-size: 11px;
		color: #b26a00;
	}
</style>
