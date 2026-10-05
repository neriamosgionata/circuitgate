import { describe, expect, it } from 'vitest';
import type { WaveformChange } from '../../../sim/recorder';
import {
	buildLanes,
	changeIndexAt,
	segmentsForChanges,
	sliceSegments,
	tickToX,
	visibleLaneRange,
	windowSegments,
	xToTick,
	type WaveformSegment
} from '../lane';

function changes(entries: Array<[number, WaveformChange['value'], boolean?]>): WaveformChange[] {
	return entries.map(([tick, value, oscillating = false]) => ({ tick, value, oscillating }));
}

describe('waveform lanes', () => {
	it('virtualizes lanes to the visible window with overscan and clamps edges', () => {
		expect(visibleLaneRange(0, 100, 20, 50)).toEqual({ start: 0, end: 7 });
		expect(visibleLaneRange(200, 100, 20, 50)).toEqual({ start: 8, end: 17 });
		expect(visibleLaneRange(2000, 100, 20, 10)).toEqual({ start: 10, end: 10 });
		expect(visibleLaneRange(0, 0, 20, 10)).toEqual({ start: 0, end: 2 });
		expect(visibleLaneRange(-40, 100, 20, 10)).toEqual({ start: 0, end: 7 });
		expect(visibleLaneRange(0, 100, 20, 0)).toEqual({ start: 0, end: 0 });
		expect(() => visibleLaneRange(0, 100, 0, 10)).toThrow();
	});

	it('builds segments from change lists with an explicit end tick', () => {
		const list = changes([
			[0, 0],
			[5, 1],
			[8, 1, true]
		]);
		expect(segmentsForChanges(list, 10)).toEqual([
			{ startTick: 0, endTick: 5, value: 0, oscillating: false },
			{ startTick: 5, endTick: 8, value: 1, oscillating: false },
			{ startTick: 8, endTick: 10, value: 1, oscillating: true }
		]);
		expect(segmentsForChanges(list, 8)).toHaveLength(2);
		expect(segmentsForChanges([], 8)).toEqual([]);
	});

	it('slices segments to the visible time window by binary search', () => {
		const segments = segmentsForChanges(
			changes([
				[0, 0],
				[5, 1],
				[8, 1, true]
			]),
			10
		);
		expect(sliceSegments(segments, 4, 9)).toEqual([
			{ startTick: 4, endTick: 5, value: 0, oscillating: false },
			{ startTick: 5, endTick: 8, value: 1, oscillating: false },
			{ startTick: 8, endTick: 9, value: 1, oscillating: true }
		]);
		expect(sliceSegments(segments, 10, 12)).toEqual([]);
		expect(sliceSegments(segments, -5, 1)).toEqual([
			{ startTick: 0, endTick: 1, value: 0, oscillating: false }
		]);
	});

	it('builds windowed segments with the time binary search', () => {
		const list = changes([
			[0, 0],
			[5, 1],
			[8, 1, true]
		]);
		expect(windowSegments(list, 4, 9)).toEqual([
			{ startTick: 4, endTick: 5, value: 0, oscillating: false },
			{ startTick: 5, endTick: 8, value: 1, oscillating: false },
			{ startTick: 8, endTick: 9, value: 1, oscillating: true }
		]);
		expect(windowSegments(list, -3, 1)).toEqual([
			{ startTick: 0, endTick: 1, value: 0, oscillating: false }
		]);
		expect(windowSegments(list, 10, 12)).toEqual([
			{ startTick: 10, endTick: 12, value: 1, oscillating: true }
		]);
		expect(windowSegments([], 0, 5)).toEqual([]);
	});

	it('builds one lane per net and keeps empty lanes', () => {
		const histories = new Map<string, readonly WaveformChange[]>([
			['a', changes([[0, 0], [3, 1]])],
			['b', []]
		]);
		const lanes = buildLanes(['a', 'b', 'c'], histories, 6);
		expect(lanes.map((lane) => lane.net)).toEqual(['a', 'b', 'c']);
		expect(lanes[0].segments).toEqual([
			{ startTick: 0, endTick: 3, value: 0, oscillating: false },
			{ startTick: 3, endTick: 6, value: 1, oscillating: false }
		]);
		expect(lanes[1].segments).toEqual([]);
		expect(lanes[2].segments).toEqual([]);
	});

	it('maps between ticks and pixels', () => {
		expect(tickToX(5, 2, 10)).toBe(30);
		expect(tickToX(2, 2, 10)).toBe(0);
		expect(xToTick(30, 2, 10)).toBe(5);
		expect(xToTick(0, 2, 10)).toBe(2);
		expect(() => xToTick(0, 0, 0)).toThrow();
	});

	it('re-exports the time binary search used by the viewer', () => {
		const list = changes([
			[0, 0],
			[4, 1]
		]);
		expect(changeIndexAt(list, 3)).toBe(0);
		expect(changeIndexAt(list, 4)).toBe(1);
	});

	it('segment type stays structurally compatible with drawn segments', () => {
		const segment: WaveformSegment = { startTick: 0, endTick: 1, value: 'Z', oscillating: false };
		expect(segment.value).toBe('Z');
	});
});
