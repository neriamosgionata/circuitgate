<script lang="ts">
	import { onMount } from 'svelte';
	import { presentSignal } from '../../render/scene';
	import type { WaveformChange } from '../../sim/recorder';
	import {
		tickToX,
		visibleLaneRange,
		windowSegments,
		type WaveformSegment
	} from './lane';

	interface Props {
		nets: readonly string[];
		historyFor: (net: string) => readonly WaveformChange[];
		tick: number;
		version: number;
		selectedNets?: ReadonlySet<string>;
		onSelectNet?: (net: string) => void;
	}

	let {
		nets,
		historyFor,
		tick,
		version,
		selectedNets = new Set<string>(),
		onSelectNet
	}: Props = $props();

	const ROW_HEIGHT = 22;
	const GUTTER = 120;

	let wrapper: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let scrollTop = $state(0);
	let width = $state(640);
	let height = $state(180);

	const startTick = $derived.by(() => {
		void version;
		let first = Number.POSITIVE_INFINITY;
		for (const net of nets) {
			const history = historyFor(net);
			if (history.length > 0) first = Math.min(first, history[0].tick);
		}
		return Number.isFinite(first) ? first : 0;
	});

	const endTick = $derived(Math.max(tick, startTick + 1));

	function drawSegment(
		ctx: CanvasRenderingContext2D,
		segment: WaveformSegment,
		firstTick: number,
		tickScale: number,
		rowTop: number,
		rowBottom: number
	) {
		const signal = presentSignal(segment.value, segment.oscillating);
		const x0 = GUTTER + tickToX(segment.startTick, firstTick, tickScale);
		const x1 = GUTTER + tickToX(segment.endTick, firstTick, tickScale);
		const highY = rowTop + 4;
		const lowY = rowBottom - 5;
		const midY = (highY + lowY) / 2;
		ctx.save();
		ctx.strokeStyle = signal.color;
		ctx.lineWidth = segment.oscillating ? 2.5 : 1.8;
		if (signal.pattern === 'hatched') {
			ctx.fillStyle = 'rgba(178, 106, 0, 0.18)';
			ctx.fillRect(x0, highY, Math.max(1, x1 - x0), lowY - highY);
			ctx.beginPath();
			for (let x = x0; x < x1; x += 6) {
				ctx.moveTo(x, lowY);
				ctx.lineTo(Math.min(x + (lowY - highY), x1), highY);
			}
			ctx.stroke();
		} else if (signal.pattern === 'dashed') {
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.moveTo(x0, midY);
			ctx.lineTo(x1, midY);
			ctx.stroke();
		} else {
			const y = signal.level === 'high' ? highY : lowY;
			ctx.beginPath();
			ctx.moveTo(x0, y);
			ctx.lineTo(x1, y);
			ctx.stroke();
			if (segment.oscillating) {
				ctx.setLineDash([3, 3]);
				ctx.beginPath();
				ctx.moveTo(x0, y);
				ctx.lineTo(x1, y);
				ctx.stroke();
			}
		}
		ctx.restore();
	}

	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.max(1, Math.round(width * dpr));
		const pixelHeight = Math.max(1, Math.round(height * dpr));
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = '#fafafa';
		ctx.fillRect(0, 0, width, height);

		const plotWidth = Math.max(1, width - GUTTER);
		const span = Math.max(1, endTick - startTick);
		const tickScale = plotWidth / span;
		const range = visibleLaneRange(scrollTop, height, ROW_HEIGHT, nets.length);
		const offset = range.start * ROW_HEIGHT - scrollTop;

		ctx.font = '11px sans-serif';
		ctx.textBaseline = 'middle';
		for (let index = range.start; index < range.end; index++) {
			const net = nets[index];
			const rowTop = offset + (index - range.start) * ROW_HEIGHT;
			const rowBottom = rowTop + ROW_HEIGHT;
			ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#f4f6f7';
			ctx.fillRect(0, rowTop, width, ROW_HEIGHT);
			ctx.fillStyle = selectedNets.has(net) ? '#1565c0' : '#37474f';
			ctx.fillText(net, 8, rowTop + ROW_HEIGHT / 2, GUTTER - 16);
			for (const segment of windowSegments(historyFor(net), startTick, endTick)) {
				drawSegment(ctx, segment, startTick, tickScale, rowTop, rowBottom);
			}
			ctx.strokeStyle = '#cfd8dc';
			ctx.beginPath();
			ctx.moveTo(0, rowBottom - 0.5);
			ctx.lineTo(width, rowBottom - 0.5);
			ctx.stroke();
		}
		ctx.strokeStyle = '#b0bec5';
		ctx.beginPath();
		ctx.moveTo(GUTTER - 0.5, 0);
		ctx.lineTo(GUTTER - 0.5, height);
		ctx.stroke();
	}

	function selectAt(event: MouseEvent) {
		if (!wrapper || !onSelectNet) return;
		const rect = wrapper.getBoundingClientRect();
		const index = Math.floor((event.clientY - rect.top + scrollTop) / ROW_HEIGHT);
		if (index < 0 || index >= nets.length) return;
		onSelectNet(nets[index]);
	}

	onMount(() => {
		const resizeObserver = new ResizeObserver(() => {
			if (!wrapper) return;
			width = Math.max(1, wrapper.clientWidth);
			height = Math.max(1, wrapper.clientHeight);
		});
		if (wrapper) resizeObserver.observe(wrapper);
		let frame = 0;
		const loop = () => {
			draw();
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(frame);
			resizeObserver.disconnect();
		};
	});
</script>

<div class="viewer" bind:this={wrapper}>
	<canvas bind:this={canvas}></canvas>
	<div
		class="scroll"
		role="listbox"
		tabindex="0"
		aria-label="Waveform lanes"
		onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
		onclick={selectAt}
		onkeydown={(event) => {
			if (event.key === 'ArrowDown') scrollTop += ROW_HEIGHT;
			if (event.key === 'ArrowUp') scrollTop = Math.max(0, scrollTop - ROW_HEIGHT);
		}}
	>
		<div style:height="{nets.length * ROW_HEIGHT}px"></div>
	</div>
	{#if nets.length === 0}
		<p class="empty">Run the simulation to record waveforms.</p>
	{/if}
</div>

<style>
	.viewer {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 140px;
		overflow: hidden;
		background: #fafafa;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
	}

	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.scroll {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		overflow-x: hidden;
		cursor: pointer;
	}

	.scroll > div {
		width: 1px;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: #90a4ae;
		pointer-events: none;
	}
</style>
