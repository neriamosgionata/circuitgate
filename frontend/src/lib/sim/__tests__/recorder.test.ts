import { describe, expect, it } from 'vitest';
import { changeIndexAt, DEFAULT_RETENTION_PER_NET, WaveformRecorder } from '../recorder';

describe('WaveformRecorder', () => {
	it('stores only value changes and ignores repeats', () => {
		const recorder = new WaveformRecorder();
		expect(recorder.record(0, 'n1', 0)).toBe(true);
		expect(recorder.record(1, 'n1', 0)).toBe(false);
		expect(recorder.record(2, 'n1', 1)).toBe(true);
		expect(recorder.record(3, 'n1', 1)).toBe(false);
		expect(recorder.record(4, 'n1', 'X')).toBe(true);
		expect(recorder.history('n1')).toEqual([
			{ tick: 0, value: 0, oscillating: false },
			{ tick: 2, value: 1, oscillating: false },
			{ tick: 4, value: 'X', oscillating: false }
		]);
		expect(recorder.changeCount).toBe(3);
		expect(recorder.netCount).toBe(1);
		expect(recorder.lastTick()).toBe(4);
		expect(DEFAULT_RETENTION_PER_NET).toBeGreaterThan(0);
	});

	it('treats an oscillation flag change as a recorded change', () => {
		const recorder = new WaveformRecorder();
		expect(recorder.record(0, 'n1', 0, false)).toBe(true);
		expect(recorder.record(1, 'n1', 0, true)).toBe(true);
		expect(recorder.record(2, 'n1', 0, true)).toBe(false);
		expect(recorder.record(3, 'n1', 0, false)).toBe(true);
		expect(recorder.history('n1')).toHaveLength(3);
	});

	it('binary search returns the value at an arbitrary time', () => {
		const recorder = new WaveformRecorder();
		recorder.record(0, 'clk', 0);
		recorder.record(5, 'clk', 1);
		recorder.record(10, 'clk', 0);
		expect(recorder.valueAt('clk', 0)).toBe(0);
		expect(recorder.valueAt('clk', 4)).toBe(0);
		expect(recorder.valueAt('clk', 5)).toBe(1);
		expect(recorder.valueAt('clk', 9)).toBe(1);
		expect(recorder.valueAt('clk', 10)).toBe(0);
		expect(recorder.valueAt('clk', 1000)).toBe(0);
		expect(recorder.valueAt('clk', -1)).toBeUndefined();
		expect(recorder.valueAt('missing', 5)).toBeUndefined();
		expect(recorder.firstTick('clk')).toBe(0);
		expect(recorder.firstTick('missing')).toBeUndefined();
	});

	it('bounds stored history with the retention cap while keeping recent values searchable', () => {
		const recorder = new WaveformRecorder({ retentionPerNet: 8 });
		for (let tick = 0; tick < 100; tick++) {
			recorder.record(tick, 'n', tick % 2 === 0 ? 0 : 1);
		}
		const history = recorder.history('n');
		expect(history.length).toBeLessThanOrEqual(8);
		expect(history.length).toBeGreaterThan(0);
		const first = history[0];
		expect(recorder.firstTick('n')).toBe(first.tick);
		for (const tick of [first.tick, first.tick + 1, 99]) {
			expect(recorder.valueAt('n', tick), `tick ${tick}`).toBe(tick % 2 === 0 ? 0 : 1);
		}
		expect(recorder.valueAt('n', first.tick - 1)).toBeUndefined();
		expect(recorder.changeCount).toBe(history.length);
	});

	it('rejects invalid records and non-monotonic ticks', () => {
		const recorder = new WaveformRecorder();
		expect(() => recorder.record(-1, 'n', 0)).toThrow();
		expect(() => recorder.record(0.5, 'n', 0)).toThrow();
		expect(() => recorder.record(0, '', 0)).toThrow();
		expect(() => new WaveformRecorder({ retentionPerNet: 0 })).toThrow();
		recorder.record(4, 'n', 0);
		expect(() => recorder.record(3, 'n', 1)).toThrow();
	});

	it('clears every history', () => {
		const recorder = new WaveformRecorder();
		recorder.record(0, 'a', 0);
		recorder.record(0, 'b', 1);
		recorder.clear();
		expect(recorder.changeCount).toBe(0);
		expect(recorder.nets()).toEqual([]);
		expect(recorder.history('a')).toEqual([]);
	});

	it('changeIndexAt locates the active change for a tick', () => {
		const changes = [
			{ tick: 2, value: 0 as const, oscillating: false },
			{ tick: 7, value: 1 as const, oscillating: false }
		];
		expect(changeIndexAt(changes, 1)).toBe(-1);
		expect(changeIndexAt(changes, 2)).toBe(0);
		expect(changeIndexAt(changes, 6)).toBe(0);
		expect(changeIndexAt(changes, 7)).toBe(1);
		expect(changeIndexAt(changes, 99)).toBe(1);
		expect(changeIndexAt([], 0)).toBe(-1);
	});
});
