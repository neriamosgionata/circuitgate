import type { LogicValue } from '../../engine/values';
import { changeIndexAt, type WaveformChange } from '../../sim/recorder';

export interface WaveformSegment {
	startTick: number;
	endTick: number;
	value: LogicValue;
	oscillating: boolean;
}

export interface WaveformLane {
	net: string;
	segments: WaveformSegment[];
}

export interface VisibleLaneRange {
	start: number;
	end: number;
}

export { changeIndexAt };

export function visibleLaneRange(
	scrollTop: number,
	viewportHeight: number,
	rowHeight: number,
	laneCount: number,
	overscan = 2
): VisibleLaneRange {
	if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
		throw new Error(`rowHeight must be positive, got ${rowHeight}`);
	}
	if (!Number.isFinite(scrollTop) || !Number.isFinite(viewportHeight) || !Number.isFinite(laneCount)) {
		throw new Error('scrollTop, viewportHeight, and laneCount must be finite');
	}
	const top = Math.max(0, scrollTop);
	const first = Math.floor(top / rowHeight);
	const visible = Math.max(0, Math.ceil(viewportHeight / rowHeight));
	const end = Math.min(Math.max(0, laneCount), first + visible + overscan);
	const start = Math.min(Math.max(0, first - overscan), end);
	return { start, end };
}

export function segmentsForChanges(
	changes: readonly WaveformChange[],
	endTick: number
): WaveformSegment[] {
	const segments: WaveformSegment[] = [];
	for (let index = 0; index < changes.length; index++) {
		const change = changes[index];
		const next = changes[index + 1];
		const segmentEnd = next ? next.tick : endTick;
		if (segmentEnd <= change.tick) continue;
		segments.push({
			startTick: change.tick,
			endTick: segmentEnd,
			value: change.value,
			oscillating: change.oscillating
		});
	}
	return segments;
}

export function sliceSegments(
	segments: readonly WaveformSegment[],
	fromTick: number,
	toTick: number
): WaveformSegment[] {
	if (toTick <= fromTick) return [];
	const sliced: WaveformSegment[] = [];
	for (const segment of segments) {
		if (segment.endTick <= fromTick || segment.startTick >= toTick) continue;
		sliced.push({
			...segment,
			startTick: Math.max(segment.startTick, fromTick),
			endTick: Math.min(segment.endTick, toTick)
		});
	}
	return sliced;
}

export function windowSegments(
	changes: readonly WaveformChange[],
	fromTick: number,
	toTick: number
): WaveformSegment[] {
	if (toTick <= fromTick) return [];
	const index = changeIndexAt(changes, fromTick);
	const start = index === -1 ? 0 : index;
	return sliceSegments(segmentsForChanges(changes.slice(start), toTick), fromTick, toTick);
}

export function buildLanes(
	netIds: readonly string[],
	histories: ReadonlyMap<string, readonly WaveformChange[]>,
	endTick: number
): WaveformLane[] {
	return netIds.map((net) => ({
		net,
		segments: segmentsForChanges(histories.get(net) ?? [], endTick)
	}));
}

export function tickToX(tick: number, startTick: number, tickScale: number): number {
	return (tick - startTick) * tickScale;
}

export function xToTick(x: number, startTick: number, tickScale: number): number {
	if (!(tickScale > 0)) {
		throw new Error(`tickScale must be positive, got ${tickScale}`);
	}
	return startTick + x / tickScale;
}
