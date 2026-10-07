<script lang="ts">
	import { onMount } from 'svelte';

	import { formatSI } from '../../../engine/analog/si';
	import {
		decimateMinMax,
		isFullDetail,
		lowerBound,
		sampleAt,
		upperBound
	} from '../../../sim/analog/decimate';
	import type { AnalogResultVariable } from '../../../sim/analog/protocol';
	import type { AnalysisOutcome } from '../../../sim/analog/results';
	import { TRACE_COLORS } from '../../../sim/analog/results';

	interface Props {
		outcome: AnalysisOutcome;
	}

	let { outcome }: Props = $props();

	const PAD_LEFT = 44;
	const PAD_RIGHT = 12;
	const PAD_TOP = 6;
	const AXIS_HEIGHT = 22;
	const GAP = 16;

	interface BodeTrace {
		name: string;
		color: string;
		logX: Float64Array;
		gainDb: Float64Array;
		phaseDeg: Float64Array;
		cornerHz: number | null;
		maxGainDb: number;
		gainMin: number;
		gainMax: number;
	}

	let plotEl: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let width = $state(640);
	let height = $state(280);
	let windowStart = $state(0);
	let windowEnd = $state(0);
	let selectedTrace = $state('');
	let hiddenTraces = $state<ReadonlySet<string>>(new Set());
	let cursor = $state<{ logF: number; x: number; gainDb: number; phaseDeg: number; trace: string } | null>(
		null
	);
	let dragging = $state(false);
	let dragOrigin: { x: number; start: number; end: number } | null = null;
	let renderCount = $state(0);
	let lastRenderMs = $state(0);
	let firstRenderMs = $state<number | null>(null);
	let frame = 0;
	let mountedAt = 0;

	const axis = $derived(
		outcome.variables.find((variable) => variable.type === 'frequency') ??
			outcome.variables.find((variable) => variable.name.toLowerCase() === 'frequency') ??
			null
	);
	const sourceVariables = $derived(
		axis ? outcome.variables.filter((variable) => variable !== axis) : []
	);
	const allTraces = $derived.by<BodeTrace[]>(() => {
		if (!axis) return [];
		return sourceVariables.map((variable, index) => {
			const length = axis.real.length;
			const logX = new Float64Array(length);
			const gainDb = new Float64Array(length);
			const phaseDeg = new Float64Array(length);
			let gainMin = Number.POSITIVE_INFINITY;
			let gainMax = Number.NEGATIVE_INFINITY;
			let maxIndex = 0;
			for (let point = 0; point < length; point += 1) {
				const real = variable.real[point];
				const imag = variable.imag ? variable.imag[point] : 0;
				const magnitude = Math.hypot(real, imag);
				logX[point] = Math.log10(axis.real[point]);
				gainDb[point] = 20 * Math.log10(magnitude === 0 ? 1e-300 : magnitude);
				phaseDeg[point] = (Math.atan2(imag, real) * 180) / Math.PI;
				if (gainDb[point] < gainMin) gainMin = gainDb[point];
				if (gainDb[point] > gainMax) {
					gainMax = gainDb[point];
					maxIndex = point;
				}
			}
			let cornerHz: number | null = null;
			const threshold = gainMax - 3;
			for (let point = maxIndex + 1; point < length; point += 1) {
				if (gainDb[point - 1] > threshold && gainDb[point] <= threshold) {
					const span = gainDb[point - 1] - gainDb[point];
					const fraction = span === 0 ? 0 : (gainDb[point - 1] - threshold) / span;
					const logCorner =
						logX[point - 1] + (logX[point] - logX[point - 1]) * fraction;
					cornerHz = Math.pow(10, logCorner);
					break;
				}
			}
			return {
				name: variable.name,
				color: TRACE_COLORS[index % TRACE_COLORS.length],
				logX,
				gainDb,
				phaseDeg,
				cornerHz,
				maxGainDb: gainMax,
				gainMin,
				gainMax
			};
		});
	});
	const visibleTraces = $derived(allTraces.filter((trace) => !hiddenTraces.has(trace.name)));
	const visibleSamples = $derived.by(() => {
		if (!axis || !(windowEnd > windowStart)) return 0;
		return upperBound(axis.real, Math.pow(10, windowEnd)) - lowerBound(axis.real, Math.pow(10, windowStart));
	});

	function resetWindow(): void {
		if (!axis || axis.real.length === 0) return;
		windowStart = Math.log10(Math.max(axis.real[0], Number.MIN_VALUE));
		windowEnd = Math.log10(axis.real[axis.real.length - 1]);
		cursor = null;
	}

	$effect(() => {
		void axis;
		resetWindow();
		selectedTrace = allTraces[0]?.name ?? '';
		hiddenTraces = new Set();
	});

	function plotWidth(): number {
		return Math.max(1, width - PAD_LEFT - PAD_RIGHT);
	}

	function xOf(logF: number): number {
		const span = windowEnd - windowStart;
		if (!(span > 0)) return PAD_LEFT;
		return PAD_LEFT + ((logF - windowStart) / span) * plotWidth();
	}

	function logAt(x: number): number {
		return windowStart + ((x - PAD_LEFT) / plotWidth()) * (windowEnd - windowStart);
	}

	function clampWindow(start: number, end: number): void {
		if (!axis) return;
		const first = Math.log10(Math.max(axis.real[0], Number.MIN_VALUE));
		const last = Math.log10(axis.real[axis.real.length - 1]);
		const full = last - first;
		if (!(full > 0)) return;
		const span = Math.min(Math.max(end - start, full / 1000), full);
		let nextStart = start;
		if (nextStart < first) nextStart = first;
		if (nextStart + span > last) nextStart = last - span;
		windowStart = nextStart;
		windowEnd = nextStart + span;
	}

	function zoomAt(x: number, factor: number): void {
		const anchor = logAt(x);
		const span = windowEnd - windowStart;
		const fraction = span > 0 ? (anchor - windowStart) / span : 0.5;
		const nextSpan = span * factor;
		clampWindow(anchor - fraction * nextSpan, anchor + (1 - fraction) * nextSpan);
	}

	function drawAxis(ctx: CanvasRenderingContext2D, bottom: number): void {
		const first = Math.ceil(windowStart);
		const last = Math.floor(windowEnd);
		ctx.strokeStyle = '#cfd8dc';
		ctx.fillStyle = '#546e7a';
		ctx.font = '10px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (let decade = first; decade <= last; decade += 1) {
			const x = xOf(decade);
			ctx.beginPath();
			ctx.moveTo(x, PAD_TOP);
			ctx.lineTo(x, bottom);
			ctx.stroke();
			ctx.fillText(`${formatSI(Math.pow(10, decade))}Hz`, x, bottom + 4);
		}
	}

	function draw(): void {
		if (!canvas || !axis || visibleTraces.length === 0) return;
		const started = performance.now();
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

		const plotBottom = height - AXIS_HEIGHT;
		const gainTop = PAD_TOP;
		const gainBottom = PAD_TOP + (plotBottom - PAD_TOP - GAP) * 0.56;
		const phaseTop = gainBottom + GAP;
		const phaseBottom = plotBottom;
		drawAxis(ctx, plotBottom);

		for (const region of [
			{ top: gainTop, bottom: gainBottom },
			{ top: phaseTop, bottom: phaseBottom }
		]) {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(PAD_LEFT, region.top, plotWidth(), region.bottom - region.top);
			ctx.strokeStyle = '#eceff1';
			ctx.beginPath();
			ctx.moveTo(PAD_LEFT, region.bottom - 0.5);
			ctx.lineTo(width - PAD_RIGHT, region.bottom - 0.5);
			ctx.stroke();
		}

		for (const trace of visibleTraces) {
			const gainSeries = decimateMinMax(trace.logX, trace.gainDb, windowStart, windowEnd, plotWidth());
			const phaseSeries = decimateMinMax(
				trace.logX,
				trace.phaseDeg,
				windowStart,
				windowEnd,
				plotWidth()
			);
			drawSeries(ctx, gainSeries.x, gainSeries.y, gainTop, gainBottom, trace.color);
			drawSeries(ctx, phaseSeries.x, phaseSeries.y, phaseTop, phaseBottom, trace.color);
		}

		const gainLabel = visibleTraces[0];
		if (gainLabel) {
			const gainStats = windowRange(gainLabel.logX, gainLabel.gainDb, windowStart, windowEnd);
			ctx.fillStyle = '#90a4ae';
			ctx.font = '9px sans-serif';
			ctx.textAlign = 'left';
			ctx.fillText(`${gainStats.max.toFixed(1)} dB`, 4, gainTop + 4);
			ctx.fillText(`${gainStats.min.toFixed(1)} dB`, 4, gainBottom - 12);
			const phaseStats = windowRange(
				gainLabel.logX,
				gainLabel.phaseDeg,
				windowStart,
				windowEnd
			);
			ctx.fillText(`${phaseStats.max.toFixed(0)}°`, 4, phaseTop + 4);
			ctx.fillText(`${phaseStats.min.toFixed(0)}°`, 4, phaseBottom - 12);
		}

		if (cursor) {
			ctx.strokeStyle = '#37474f';
			ctx.setLineDash([2, 2]);
			ctx.beginPath();
			ctx.moveTo(cursor.x, PAD_TOP);
			ctx.lineTo(cursor.x, plotBottom);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		renderCount += 1;
		lastRenderMs = performance.now() - started;
		if (firstRenderMs === null) firstRenderMs = performance.now() - mountedAt;
	}

	function windowRange(
		logX: Float64Array,
		values: Float64Array,
		from: number,
		to: number
	): { min: number; max: number } {
		const start = lowerBound(logX, from);
		const end = upperBound(logX, to);
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (let index = start; index < end; index += 1) {
			if (values[index] < min) min = values[index];
			if (values[index] > max) max = values[index];
		}
		if (!Number.isFinite(min)) return { min: 0, max: 0 };
		return { min, max };
	}

	function drawSeries(
		ctx: CanvasRenderingContext2D,
		x: Float64Array,
		y: Float64Array,
		top: number,
		bottom: number,
		color: string
	): void {
		if (x.length === 0) return;
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const value of y) {
			if (value < min) min = value;
			if (value > max) max = value;
		}
		if (!(max > min)) {
			max += 1;
			min -= 1;
		}
		const pad = (max - min) * 0.1;
		const yMin = min - pad;
		const yMax = max + pad;
		const yOf = (value: number): number =>
			bottom - ((value - yMin) / (yMax - yMin)) * (bottom - top);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(xOf(x[0]), yOf(y[0]));
		for (let point = 1; point < x.length; point += 1) {
			ctx.lineTo(xOf(x[point]), yOf(y[point]));
		}
		ctx.stroke();
		ctx.lineWidth = 1;
	}

	function scheduleDraw(): void {
		if (frame !== 0) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			draw();
		});
	}

	$effect(() => {
		void outcome;
		void width;
		void height;
		void windowStart;
		void windowEnd;
		void cursor;
		void selectedTrace;
		void hiddenTraces;
		scheduleDraw();
	});

	function selectTrace(name: string): void {
		selectedTrace = name;
		cursor = null;
	}

	function toggleTrace(name: string): void {
		const next = new Set(hiddenTraces);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		hiddenTraces = next;
	}

	function updateCursor(event: PointerEvent): void {
		if (!plotEl || !axis) return;
		const rect = plotEl.getBoundingClientRect();
		const x = Math.min(Math.max(event.clientX - rect.left, PAD_LEFT), width - PAD_RIGHT);
		const logF = logAt(x);
		const trace = allTraces.find((entry) => entry.name === selectedTrace) ?? allTraces[0];
		if (!trace) return;
		const gainDb = sampleAt(trace.logX, trace.gainDb, logF);
		const phaseDeg = sampleAt(trace.logX, trace.phaseDeg, logF);
		cursor =
			gainDb === null || phaseDeg === null
				? null
				: { logF, x, gainDb, phaseDeg, trace: trace.name };
	}

	function onPointerDown(event: PointerEvent): void {
		if (!plotEl) return;
		try {
			plotEl.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events have no capturable pointer; drag still works.
		}
		dragging = true;
		dragOrigin = { x: event.clientX, start: windowStart, end: windowEnd };
		updateCursor(event);
	}

	function onPointerMove(event: PointerEvent): void {
		if (dragging && dragOrigin && plotEl) {
			const deltaPixels = event.clientX - dragOrigin.x;
			const span = dragOrigin.end - dragOrigin.start;
			const deltaLog = -(deltaPixels / plotWidth()) * span;
			clampWindow(dragOrigin.start + deltaLog, dragOrigin.end + deltaLog);
		}
		updateCursor(event);
	}

	function onPointerUp(event: PointerEvent): void {
		dragging = false;
		dragOrigin = null;
		if (plotEl) {
			try {
				plotEl.releasePointerCapture(event.pointerId);
			} catch {
				// Pointer was not captured.
			}
		}
	}

	function onWheel(event: WheelEvent): void {
		event.preventDefault();
		if (!plotEl) return;
		const rect = plotEl.getBoundingClientRect();
		const x = Math.min(Math.max(event.clientX - rect.left, PAD_LEFT), width - PAD_RIGHT);
		zoomAt(x, event.deltaY < 0 ? 1 / 1.2 : 1.2);
	}

	onMount(() => {
		mountedAt = performance.now();
		const observer = new ResizeObserver(() => {
			if (!plotEl) return;
			width = Math.max(1, plotEl.clientWidth);
			height = Math.max(1, plotEl.clientHeight);
		});
		if (plotEl) observer.observe(plotEl);
		scheduleDraw();
		return () => {
			if (frame !== 0) cancelAnimationFrame(frame);
			frame = 0;
			observer.disconnect();
		};
	});
</script>

<section
	class="bode"
	data-testid="bode-view"
	data-freq-start={axis ? Math.pow(10, windowStart) : ''}
	data-freq-stop={axis ? Math.pow(10, windowEnd) : ''}
	data-visible-samples={visibleSamples}
	data-render-count={renderCount}
	data-last-render-ms={lastRenderMs.toFixed(2)}
	data-first-render-ms={firstRenderMs === null ? '' : firstRenderMs.toFixed(2)}
>
	<div class="toolbar">
		<button type="button" data-testid="bode-zoom-in" onclick={() => zoomAt(width / 2, 1 / 1.5)}>
			Zoom in
		</button>
		<button type="button" data-testid="bode-zoom-out" onclick={() => zoomAt(width / 2, 1.5)}>
			Zoom out
		</button>
		<button type="button" data-testid="bode-fit" onclick={resetWindow}>Fit</button>
		<span class="resolution" data-testid="bode-resolution" data-mode={isFullDetail(visibleSamples, plotWidth()) ? 'full' : 'decimated'}>
			{isFullDetail(visibleSamples, plotWidth()) ? 'full detail' : 'min/max decimated'}
		</span>
	</div>

	{#if allTraces.length === 0 || visibleTraces.length === 0}
		<p class="empty" data-testid="bode-empty">
			{allTraces.length === 0 ? 'No AC traces in this result.' : 'All traces are hidden.'}
		</p>
	{:else}
		<div class="legend" data-testid="bode-legend">
			{#each allTraces as trace (trace.name)}
				<button
					type="button"
					class="trace"
					class:active={selectedTrace === trace.name}
					class:hidden={hiddenTraces.has(trace.name)}
					data-testid="bode-trace"
					data-trace={trace.name}
					data-active={selectedTrace === trace.name ? 'true' : 'false'}
					data-visible={hiddenTraces.has(trace.name) ? 'false' : 'true'}
					data-corner-hz={trace.cornerHz === null ? '' : String(trace.cornerHz)}
					data-max-gain-db={String(trace.maxGainDb)}
					data-min-gain-db={String(trace.gainMin)}
					onclick={() => selectTrace(trace.name)}
					ondblclick={() => toggleTrace(trace.name)}
				>
					<span class="swatch" style:background={trace.color}></span>
					<span class="name">{trace.name}</span>
					<span class="corner">
						{trace.cornerHz === null ? '—' : `-3 dB at ${formatSI(trace.cornerHz)}Hz`}
					</span>
				</button>
			{/each}
		</div>

		<div
			class="plot"
			bind:this={plotEl}
			role="application"
			aria-label="Bode plot: drag to pan, wheel to zoom"
			data-testid="bode-plot"
			data-plot-left={PAD_LEFT}
			data-plot-right={width - PAD_RIGHT}
			data-plot-height={Math.max(1, height - AXIS_HEIGHT)}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onpointerleave={() => (cursor = null)}
			onwheel={onWheel}
			ondblclick={resetWindow}
		>
			<canvas bind:this={canvas}></canvas>
			<div
				class="readout"
				data-testid="bode-cursor"
				data-freq={cursor ? String(Math.pow(10, cursor.logF)) : ''}
				data-gain-db={cursor ? String(cursor.gainDb) : ''}
				data-phase-deg={cursor ? String(cursor.phaseDeg) : ''}
				data-trace-name={cursor?.trace ?? ''}
			>
				{#if cursor}
					f = {formatSI(Math.pow(10, cursor.logF))}Hz · gain = {cursor.gainDb.toFixed(2)} dB ·
					phase = {cursor.phaseDeg.toFixed(1)}°
				{:else}
					Move the pointer over the plot for gain and phase at a frequency.
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.bode {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: var(--ink);
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.toolbar button {
		padding: 3px 8px;
		font-size: 11px;
	}

	.resolution {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-soft);
		margin-left: auto;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 10px;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.trace {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.swatch {
		width: 14px;
		height: 3px;
		flex: none;
	}

	.name {
		color: var(--ink);
	}

	.plot {
		position: relative;
		height: 260px;
		background: var(--sheet-sunk);
		border: var(--rule-faint);
		border-radius: 2px;
		overflow: hidden;
	}

	.plot canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.readout {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink);
		background: var(--highlight-soft);
		border: var(--rule-faint);
		border-radius: 2px;
		padding: 2px 6px;
		white-space: nowrap;
	}

	.empty {
		color: var(--ink-soft);
		font-size: 13px;
		margin: 4px 0;
	}
</style>
