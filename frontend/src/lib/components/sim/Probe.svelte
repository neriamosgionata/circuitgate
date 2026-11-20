<script lang="ts">
	import type { LogicValue } from '../../engine/values';
	import { presentSignal } from '../../render/scene';

	interface Props {
		label: string;
		value: LogicValue | undefined;
		oscillating?: boolean;
	}

	let { label, value, oscillating = false }: Props = $props();

	const signal = $derived(value === undefined ? null : presentSignal(value, oscillating));

	const swatchStyle = $derived.by(() => {
		if (!signal) return 'background:var(--sheet-sunk)';
		if (signal.pattern === 'hatched') {
			return `background:repeating-linear-gradient(45deg, ${signal.color} 0 2px, var(--sheet-raised) 2px 4px)`;
		}
		if (signal.pattern === 'dashed') {
			return `background:transparent;border:2px dashed ${signal.color}`;
		}
		return `background:${signal.color}`;
	});
</script>

<div class="probe" class:oscillating={signal?.oscillating}>
	<span class="swatch" style={swatchStyle}></span>
	<span class="label">{label}</span>
	<span class="value">{value ?? '–'}</span>
</div>

<style>
	.probe {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 4px 9px;
		border: 1px solid var(--rule);
		border-radius: var(--radius-xs);
		background: var(--paper);
		font-size: 12px;
	}

	.probe.oscillating {
		border-color: #e6b6b1;
		background: var(--danger-soft);
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 2px;
		border: 1px solid var(--rule);
		box-sizing: border-box;
	}

	.label {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-soft);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.value {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
</style>
