import { describe, expect, it } from 'vitest';

import { ANALOG_TOLERANCES, relativeError } from '../../../engine/analog/tolerance';
import type { AnalogResultVariable } from '../protocol';
import {
	RESULT_POINT_CAP,
	decimateMinMax,
	isFullDetail,
	retainResult,
	sampleAt,
	visibleStats
} from '../decimate';

function series(length: number, value: (index: number) => number) {
	const x = new Float64Array(length);
	const y = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		x[index] = index;
		y[index] = value(index);
	}
	return { x, y };
}

function variable(name: string, length: number): AnalogResultVariable {
	return { name, type: 'voltage', real: new Float64Array(length) };
}

describe('decimateMinMax', () => {
	it('returns raw samples when the visible window fits the pixel budget', () => {
		const { x, y } = series(100, (index) => Math.sin(index / 7));
		const result = decimateMinMax(x, y, 0, 99, 800);
		expect(result.fullDetail).toBe(true);
		expect(result.x.length).toBe(100);
		expect(result.y.length).toBe(100);
		expect(result.x[0]).toBe(0);
		expect(result.x[99]).toBe(99);
		expect(isFullDetail(100, 800)).toBe(true);
	});

	it('keeps roughly two samples per pixel when decimating', () => {
		const { x, y } = series(100_000, (index) => Math.sin(index / 50));
		const result = decimateMinMax(x, y, 0, 99_999, 400);
		expect(result.fullDetail).toBe(false);
		expect(result.x.length).toBeLessThanOrEqual(400 * 2 + 2);
		expect(result.x.length).toBeGreaterThanOrEqual(4);
	});

	it('preserves narrow peaks that sit between pixels', () => {
		const length = 200_000;
		const spikeStart = 98_765;
		const { x, y } = series(length, (index) => {
			if (index >= spikeStart && index < spikeStart + 5) return 9.5;
			return Math.sin(index / 500) * 0.1;
		});
		const result = decimateMinMax(x, y, 0, length - 1, 500);
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const value of result.y) {
			if (value < min) min = value;
			if (value > max) max = value;
		}
		const rawStats = visibleStats(x, y, 0, length - 1);
		expect(rawStats).not.toBeNull();
		expect(max).toBe(rawStats!.max);
		expect(max).toBe(9.5);
		expect(min).toBe(rawStats!.min);
	});

	it('emits ascending x values with the window endpoints anchored', () => {
		const { x, y } = series(50_000, (index) => Math.cos(index / 31));
		const result = decimateMinMax(x, y, 100, 49_000, 320);
		expect(result.x[0]).toBeGreaterThanOrEqual(100);
		expect(result.x[result.x.length - 1]).toBeLessThanOrEqual(49_000);
		for (let index = 1; index < result.x.length; index += 1) {
			expect(result.x[index]).toBeGreaterThanOrEqual(result.x[index - 1]);
		}
		expect(result.x[0]).toBe(100);
		expect(result.x[result.x.length - 1]).toBe(49_000);
	});

	it('returns an empty series for a window with no samples', () => {
		const { x, y } = series(1_000, (index) => index);
		const result = decimateMinMax(x, y, 10_000, 20_000, 400);
		expect(result.x.length).toBe(0);
		expect(result.y.length).toBe(0);
		expect(result.fullDetail).toBe(true);
	});

	it('survives NaN samples without corrupting the envelope', () => {
		const { x, y } = series(10_000, (index) => (index % 997 === 0 ? Number.NaN : index / 10));
		const result = decimateMinMax(x, y, 0, 9_999, 100);
		expect(result.x.length).toBeGreaterThan(0);
		expect(result.y.length).toBe(result.x.length);
		for (const value of result.y) expect(Number.isFinite(value)).toBe(true);
	});

	it('preserves an RC time constant within tolerance after decimation', () => {
		const tau = 100e-6;
		const length = 1_000_000;
		const span = 1e-3;
		const t = new Float64Array(length);
		const v = new Float64Array(length);
		for (let index = 0; index < length; index += 1) {
			t[index] = (index / (length - 1)) * span;
			v[index] = 1 - Math.exp(-t[index] / tau);
		}
		const decimated = decimateMinMax(t, v, 0, span, 700);
		expect(decimated.fullDetail).toBe(false);

		const target = 1 - Math.exp(-1);
		let crossing = Number.NaN;
		for (let index = 1; index < decimated.y.length; index += 1) {
			if (decimated.y[index - 1] <= target && decimated.y[index] >= target) {
				const y0 = decimated.y[index - 1];
				const y1 = decimated.y[index];
				const f = y1 === y0 ? 0 : (target - y0) / (y1 - y0);
				crossing = decimated.x[index - 1] + (decimated.x[index] - decimated.x[index - 1]) * f;
				break;
			}
		}
		expect(Number.isFinite(crossing)).toBe(true);
		expect(relativeError(crossing, tau)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.tranTimeConstant
		);
	});

	it('interpolates sample values for cursor readouts', () => {
		const { x, y } = series(11, (index) => index * 2);
		expect(sampleAt(x, y, 5)).toBe(10);
		expect(sampleAt(x, y, 4.5)).toBe(9);
		expect(sampleAt(x, y, -1)).toBeNull();
		expect(sampleAt(x, y, 11)).toBeNull();
	});

	it('terminates for uniform windows at awkward bucket ratios', () => {
		for (let count = 1_399; count <= 1_405; count += 1) {
			const x = new Float64Array(count);
			const y = new Float64Array(count);
			for (let index = 0; index < count; index += 1) {
				x[index] = index;
				y[index] = Math.sin(index / 3);
			}
			for (const width of [350, 466, 699, 700]) {
				const result = decimateMinMax(x, y, 0, count - 1, width);
				expect(result.y.length).toBeGreaterThan(0);
			}
		}
	});
});

describe('retainResult', () => {
	it('keeps variables untouched below the cap', () => {
		const variables = [variable('time', 1_000), variable('v(out)', 1_000)];
		const retained = retainResult(variables);
		expect(retained.variables).toBe(variables);
		expect(retained.retained).toBe(1_000);
		expect(retained.truncatedFrom).toBeNull();
	});

	it('keeps the first cap points and reports the original length', () => {
		const length = RESULT_POINT_CAP + 250_000;
		const variables = [variable('time', length), variable('v(out)', length)];
		const retained = retainResult(variables);
		expect(retained.retained).toBe(RESULT_POINT_CAP);
		expect(retained.truncatedFrom).toBe(length);
		expect(retained.variables[0].real.length).toBe(RESULT_POINT_CAP);
		expect(retained.variables[1].real.length).toBe(RESULT_POINT_CAP);
		expect(retained.variables[0].real[0]).toBe(variables[0].real[0]);
		expect(retained.variables[0].real[RESULT_POINT_CAP - 1]).toBe(
			variables[0].real[RESULT_POINT_CAP - 1]
		);
	});
});
