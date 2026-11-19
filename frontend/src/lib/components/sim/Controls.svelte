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
	<div class="transport" role="group" aria-label="Simulation transport">
		<button type="button" class="primary" onclick={onRun} disabled={!ready || running || eventLimited}>
			Run
		</button>
		<button type="button" onclick={onPause} disabled={!ready || !running}>Pause</button>
		<button type="button" onclick={onStep} disabled={!ready || running || eventLimited}>Step</button>
		<button type="button" onclick={onReset} disabled={!ready}>Reset</button>
	</div>
	<label class="mode">
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
		<span class="running" role="status">running</span>
	{/if}
	{#if pauseLabel}
		<span class="pause" data-testid="sim-pause-reason">{pauseLabel}</span>
	{/if}
</div>

<style>
	.controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 10px;
	}

	.transport {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
	}

	.transport button {
		border: 0;
		background: transparent;
		box-shadow: none;
		padding: 4px 11px;
		min-height: 28px;
		font-size: 12px;
		color: var(--ink-soft);
	}

	.transport button:hover:not(:disabled) {
		background: var(--paper-sunk);
		border-color: transparent;
		color: var(--ink);
	}

	.transport button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.transport button.primary:hover:not(:disabled) {
		background: var(--accent-strong);
		border-color: var(--accent-strong);
		color: #fff;
	}

	.mode {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--ink-soft);
	}

	.mode > span {
		font-size: 9.5px;
		font-weight: 650;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	.mode select {
		font-size: 12px;
		min-height: 30px;
		padding-block: 3px;
		padding-left: 8px;
	}

	.tick {
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		background: var(--paper-soft);
		border: 1px solid var(--rule);
		border-radius: var(--radius-xs);
		padding: 4px 8px;
	}

	.running {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ok);
		background: var(--ok-soft);
		border: 1px solid #b9dbc9;
		border-radius: var(--radius-xs);
		padding: 2px 7px;
	}

	.running::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
	}

	.pause {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--danger);
	}
</style>
