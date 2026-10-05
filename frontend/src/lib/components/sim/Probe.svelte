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
		if (!signal) return 'background:#e0e0e0';
		if (signal.pattern === 'hatched') {
			return `background:repeating-linear-gradient(45deg, ${signal.color} 0 2px, #ffffff 2px 4px)`;
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
		gap: 6px;
		padding: 3px 8px;
		border: 1px solid #cfd8dc;
		border-radius: 4px;
		background: #ffffff;
		font-size: 12px;
	}

	.probe.oscillating {
		border-color: #d84315;
		box-shadow: 0 0 0 1px rgba(216, 67, 21, 0.35);
	}

	.swatch {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		border: 1px solid #90a4ae;
		box-sizing: border-box;
	}

	.label {
		color: #546e7a;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.value {
		font-weight: 600;
		color: #263238;
		font-variant-numeric: tabular-nums;
	}
</style>
