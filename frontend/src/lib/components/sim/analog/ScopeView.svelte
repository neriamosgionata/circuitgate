<script lang="ts">
	import { onMount } from 'svelte';

	import { formatSI } from '../../../engine/analog/si';
	import {
		RESULT_POINT_CAP,
		decimateMinMax,
		isFullDetail,
		lowerBound,
		sampleAt,
		upperBound,
		visibleStats
	} from '../../../sim/analog/decimate';
	import type { AnalogResultVariable } from '../../../sim/analog/protocol';
	import { signalUnit, TRACE_COLORS, type AnalysisOutcome } from '../../../sim/analog/results';

	interface Props {
		outcome: AnalysisOutcome;
	}

	let { outcome }: Props = $props();

	const PAD_LEFT = 8;
	const PAD_RIGHT = 10;
	const PAD_TOP = 6;
	const AXIS_HEIGHT = 22;

	interface WindowStats {
		min: number;
		max: number;
		last: number;
		count: number;
	}

	let plotEl: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let width = $state(640);
	let height = $state(240);
	let windowStart = $state(0);
	let windowEnd = $state(0);
	let selectedTrace = $state('');
	let hiddenTraces = $state<ReadonlySet<string>>(new Set());
	let cursor = $state<{ t: number; x: number; value: number; trace: string } | null>(null);
	let dragging = $state(false);
	let dragOrigin: { x: number; start: number; end: number } | null = null;
	let windowStats = $state<Record<string, WindowStats>>({});
	let fullStats = $state<Record<string, WindowStats>>({});
	let fullStatsFor: unknown = null;
	let fullStatsForRecord: Record<string, WindowStats> = {};
	let renderCount = $state(0);
	let lastRenderMs = $state(0);
	let firstRenderMs = $state<number | null>(null);
	let frame = 0;
	let mountedAt = 0;

	const axis = $derived(
		outcome.variables.find((variable) => variable.type === 'time') ??
			outcome.variables.find((variable) => variable.name.toLowerCase() === 'time') ??
			null
	);
	const traces = $derived(axis ? outcome.variables.filter((variable) => variable !== axis) : []);
	const visibleTraces = $derived(traces.filter((variable) => !hiddenTraces.has(variable.name)));
	const traceInfos = $derived.by(() =>
		traces.map((variable, index) => ({
			variable,
			name: variable.name,
			color: TRACE_COLORS[index % TRACE_COLORS.length],
			points: variable.real.length
		}))
	);
	const retained = $derived(outcome.variables[0]?.real.length ?? 0);
	const capBound = $derived(outcome.truncatedFrom != null || retained === RESULT_POINT_CAP);
	const visibleCount = $derived.by(() => {
		if (!axis || !(windowEnd > windowStart)) return 0;
		return upperBound(axis.real, windowEnd) - lowerBound(axis.real, windowStart);
	});
	const fullDetail = $derived(visibleCount > 0 && isFullDetail(visibleCount, width));
	const capText = $derived(
		outcome.truncatedFrom != null
			? `retained ${retained.toLocaleString()} of ${outcome.truncatedFrom.toLocaleString()} samples (point cap)`
			: `retained at the ${RESULT_POINT_CAP.toLocaleString()}-sample point cap`
	);
	const resolutionText = $derived.by(() => {
		if (visibleCount === 0) return 'no samples in view';
		const mode = fullDetail ? 'full detail' : 'min/max decimated';
		return capBound ? `${mode} · ${capText}` : mode;
	});

	const unitFor = (variable: AnalogResultVariable | undefined): string => signalUnit(variable);

	function numberText(value: number | undefined): string {
		return value !== undefined && Number.isFinite(value) ? String(value) : '';
	}

	function resetWindow(): void {
		if (!axis || axis.real.length === 0) return;
		windowStart = axis.real[0];
		windowEnd = axis.real[axis.real.length - 1];
		cursor = null;
	}

	$effect(() => {
		void axis;
		resetWindow();
		selectedTrace = traces[0]?.name ?? '';
		hiddenTraces = new Set();
	});

	function plotWidth(): number {
		return Math.max(1, width - PAD_LEFT - PAD_RIGHT);
	}

	function xOf(t: number): number {
		const span = windowEnd - windowStart;
		if (!(span > 0)) return PAD_LEFT;
		return PAD_LEFT + ((t - windowStart) / span) * plotWidth();
	}

	function timeAt(x: number): number {
		const span = windowEnd - windowStart;
		return windowStart + ((x - PAD_LEFT) / plotWidth()) * span;
	}

	function clampWindow(start: number, end: number): void {
		if (!axis) return;
		const first = axis.real[0];
		const last = axis.real[axis.real.length - 1];
		const full = last - first;
		if (!(full > 0)) return;
		let span = Math.min(Math.max(end - start, full / 1e6), full);
		let nextStart = start;
		if (nextStart < first) nextStart = first;
		if (nextStart + span > last) nextStart = last - span;
		windowStart = nextStart;
		windowEnd = nextStart + span;
	}

	function zoomAt(x: number, factor: number): void {
		const anchor = timeAt(x);
		const span = windowEnd - windowStart;
		const nextSpan = span * factor;
		const fraction = span > 0 ? (anchor - windowStart) / span : 0.5;
		clampWindow(anchor - fraction * nextSpan, anchor + (1 - fraction) * nextSpan);
	}

	function drawAxis(ctx: CanvasRenderingContext2D): void {
		const bottom = height - AXIS_HEIGHT;
		const span = windowEnd - windowStart;
		if (!(span > 0)) return;
		const rawStep = span / 6;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
		const candidate = [1, 2, 5, 10].find((step) => step * magnitude >= rawStep) ?? 10;
		const step = candidate * magnitude;
		const first = Math.ceil(windowStart / step) * step;
		ctx.strokeStyle = '#cfd8dc';
		ctx.fillStyle = '#546e7a';
		ctx.font = '10px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (let tick = first; tick <= windowEnd + step / 1e6; tick += step) {
			const x = xOf(tick);
			if (x < PAD_LEFT - 1 || x > width - PAD_RIGHT + 1) continue;
			ctx.beginPath();
			ctx.moveTo(x, PAD_TOP);
			ctx.lineTo(x, bottom);
			ctx.stroke();
			ctx.fillText(`${formatSI(tick)}s`, x, bottom + 4);
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

		const plotTop = PAD_TOP;
		const plotBottom = height - AXIS_HEIGHT;
		const laneHeight = Math.max(8, (plotBottom - plotTop) / visibleTraces.length);
		drawAxis(ctx);
		if (fullStatsFor !== outcome) {
			fullStatsFor = outcome;
			fullStatsForRecord = {};
			fullStats = {};
		}
		const fullWindow =
			axis.real.length > 0 &&
			windowStart <= axis.real[0] &&
			windowEnd >= axis.real[axis.real.length - 1];
		let fullStatsChanged = false;
		const nextStats: Record<string, WindowStats> = {};
		visibleTraces.forEach((variable, index) => {
			const info = traceInfos.find((entry) => entry.name === variable.name);
			const laneTop = plotTop + index * laneHeight;
			const laneBottom = laneTop + laneHeight;
			const series = decimateMinMax(
				axis.real,
				variable.real,
				windowStart,
				windowEnd,
				plotWidth()
			);
			const stats =
				series.x.length > 0
					? visibleStats(
							series.x,
							series.y,
							Number.NEGATIVE_INFINITY,
							Number.POSITIVE_INFINITY
						)
					: null;
			const windowStat: WindowStats = stats
				? { min: stats.min, max: stats.max, last: stats.last, count: stats.count }
				: { min: Number.NaN, max: Number.NaN, last: Number.NaN, count: 0 };
			nextStats[variable.name] = windowStat;
			if (fullWindow && stats && !fullStatsForRecord[variable.name]) {
				// On the full window the min/max buckets preserve the run's
				// exact extremes, so they serve as the stable scale and legend.
				fullStatsForRecord[variable.name] = windowStat;
				fullStatsChanged = true;
			}
			const scale = fullStatsForRecord[variable.name] ?? windowStat;
			let min = Number.isFinite(scale.min) ? scale.min : -1;
			let max = Number.isFinite(scale.max) ? scale.max : 1;
			if (!(max > min)) {
				const margin = Math.max(Math.abs(max) * 0.1, 0.5);
				min -= margin;
				max += margin;
			}
			const pad = (max - min) * 0.08;
			const yMin = min - pad;
			const yMax = max + pad;
			const yOf = (value: number): number =>
				laneBottom - ((value - yMin) / (yMax - yMin)) * (laneBottom - laneTop);

			ctx.fillStyle = '#ffffff';
			ctx.fillRect(PAD_LEFT, laneTop, plotWidth(), laneBottom - laneTop);
			ctx.strokeStyle = '#eceff1';
			ctx.beginPath();
			ctx.moveTo(PAD_LEFT, laneBottom - 0.5);
			ctx.lineTo(width - PAD_RIGHT, laneBottom - 0.5);
			ctx.stroke();
			if (yMin < 0 && yMax > 0) {
				ctx.strokeStyle = '#e0e0e0';
				ctx.setLineDash([3, 3]);
				ctx.beginPath();
				ctx.moveTo(PAD_LEFT, yOf(0));
				ctx.lineTo(width - PAD_RIGHT, yOf(0));
				ctx.stroke();
				ctx.setLineDash([]);
			}

			if (series.x.length > 0) {
				ctx.strokeStyle = info?.color ?? '#1565c0';
				ctx.lineWidth = 1.6;
				ctx.beginPath();
				ctx.moveTo(xOf(series.x[0]), yOf(series.y[0]));
				for (let point = 1; point < series.x.length; point += 1) {
					ctx.lineTo(xOf(series.x[point]), yOf(series.y[point]));
				}
				ctx.stroke();
				ctx.lineWidth = 1;
			}
		});
		windowStats = nextStats;
		if (fullStatsChanged) fullStats = { ...fullStatsForRecord };

		if (cursor) {
			ctx.strokeStyle = '#37474f';
			ctx.setLineDash([2, 2]);
			ctx.beginPath();
			ctx.moveTo(cursor.x, PAD_TOP);
			ctx.lineTo(cursor.x, plotBottom);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = '#37474f';
			ctx.beginPath();
			ctx.arc(cursor.x, PAD_TOP + 4, 2.5, 0, Math.PI * 2);
			ctx.fill();
		}

		renderCount += 1;
		lastRenderMs = performance.now() - started;
		if (firstRenderMs === null) firstRenderMs = performance.now() - mountedAt;
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
		const t = timeAt(x);
		const variable = traces.find((entry) => entry.name === selectedTrace) ?? traces[0];
		const value = variable ? sampleAt(axis.real, variable.real, t) : null;
		cursor =
			value === null || !variable
				? null
				: { t, x, value, trace: variable.name };
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
			const rect = plotEl.getBoundingClientRect();
			const deltaPixels = event.clientX - dragOrigin.x;
			const span = dragOrigin.end - dragOrigin.start;
			const deltaTime = -(deltaPixels / plotWidth()) * span;
			clampWindow(dragOrigin.start + deltaTime, dragOrigin.end + deltaTime);
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
	class="scope"
	data-testid="scope-view"
	data-window-start={windowStart}
	data-window-end={windowEnd}
	data-render-count={renderCount}
	data-last-render-ms={lastRenderMs.toFixed(2)}
	data-first-render-ms={firstRenderMs === null ? '' : firstRenderMs.toFixed(2)}
>
	<div class="toolbar">
		<button type="button" data-testid="scope-zoom-in" onclick={() => zoomAt(width / 2, 1 / 1.5)}>
			Zoom in
		</button>
		<button type="button" data-testid="scope-zoom-out" onclick={() => zoomAt(width / 2, 1.5)}>
			Zoom out
		</button>
		<button type="button" data-testid="scope-fit" onclick={resetWindow}>Fit</button>
		<span
			class="resolution"
			data-testid="scope-resolution"
			data-mode={fullDetail ? 'full' : 'decimated'}
			data-cap-bound={capBound ? 'true' : 'false'}
		>
			{resolutionText}
		</span>
	</div>

	{#if traces.length === 0 || visibleTraces.length === 0}
		<p class="empty" data-testid="scope-empty">
			{traces.length === 0 ? 'No transient traces in this result.' : 'All traces are hidden.'}
		</p>
	{:else}
		<div class="legend" data-testid="scope-legend">
			{#each traceInfos as trace (trace.name)}
				<button
					type="button"
					class="trace"
					class:active={selectedTrace === trace.name}
					class:hidden={hiddenTraces.has(trace.name)}
					data-testid="scope-trace"
					data-trace={trace.name}
					data-active={selectedTrace === trace.name ? 'true' : 'false'}
					data-visible={hiddenTraces.has(trace.name) ? 'false' : 'true'}
					data-points={trace.points}
					data-min={numberText(fullStats[trace.name]?.min ?? windowStats[trace.name]?.min)}
					data-max={numberText(fullStats[trace.name]?.max ?? windowStats[trace.name]?.max)}
					data-last={numberText(fullStats[trace.name]?.last ?? windowStats[trace.name]?.last)}
					data-window-min={numberText(windowStats[trace.name]?.min)}
					data-window-max={numberText(windowStats[trace.name]?.max)}
					data-window-last={numberText(windowStats[trace.name]?.last)}
					data-window-samples={windowStats[trace.name]?.count ?? 0}
					onclick={() => selectTrace(trace.name)}
					ondblclick={() => toggleTrace(trace.name)}
				>
					<span class="swatch" style:background={trace.color}></span>
					<span class="name">{trace.name}</span>
					<span class="range">
						{fullStats[trace.name] === undefined
							? '—'
							: `${formatSI(fullStats[trace.name].min)} … ${formatSI(fullStats[trace.name].max)}`}
					</span>
				</button>
			{/each}
		</div>

		<div
			class="plot"
			bind:this={plotEl}
			role="application"
			aria-label="Transient scope: drag to pan, wheel to zoom"
			data-testid="scope-plot"
			data-plot-left={PAD_LEFT}
			data-plot-right={width - PAD_RIGHT}
			data-plot-width={width}
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
				data-testid="scope-cursor"
				data-t={cursor ? String(cursor.t) : ''}
				data-value={cursor ? String(cursor.value) : ''}
				data-trace-name={cursor?.trace ?? ''}
			>
				{#if cursor}
					t = {formatSI(cursor.t)}s · {cursor.trace} = {formatSI(cursor.value)}{unitFor(
						traces.find((entry) => entry.name === cursor?.trace)
					)}
				{:else}
					Move the pointer over the plot for a value readout.
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.scope {
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

	.range {
		color: var(--ink-soft);
	}

	.plot {
		position: relative;
		height: 220px;
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
