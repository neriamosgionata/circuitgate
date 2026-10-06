import type { AnalogResultVariable } from './protocol';

/**
 * Result handling policy (U7): the solver writes a uniform output grid, the
 * results boundary retains the full run up to an explicit point cap, and the
 * inspection views decimate with min/max buckets at roughly two samples per
 * pixel. Zoom resolves within the retained detail; when a run exceeds the cap
 * the views state the bound instead of implying full resolution.
 */
export const RESULT_POINT_CAP = 1_000_000;

export const VIEW_SAMPLES_PER_PIXEL = 2;

export interface RetainedResult {
	variables: readonly AnalogResultVariable[];
	/** Points kept on the shared grid. */
	retained: number;
	/** Original point count when the cap truncated the run; otherwise null. */
	truncatedFrom: number | null;
}

function capVariable(variable: AnalogResultVariable, cap: number): AnalogResultVariable {
	const capped: AnalogResultVariable = {
		name: variable.name,
		type: variable.type,
		real: variable.real.slice(0, cap)
	};
	if (variable.imag) capped.imag = variable.imag.slice(0, cap);
	return capped;
}

/**
 * Keeps the first `cap` points of every variable. Variable arrays are copied
 * so the oversized engine buffers can be released; below the cap the input
 * is returned untouched.
 */
export function retainResult(
	variables: readonly AnalogResultVariable[],
	cap: number = RESULT_POINT_CAP
): RetainedResult {
	const length = variables[0]?.real.length ?? 0;
	if (variables.length === 0 || length <= cap) {
		return { variables, retained: length, truncatedFrom: null };
	}
	return {
		variables: variables.map((variable) => capVariable(variable, cap)),
		retained: cap,
		truncatedFrom: length
	};
}

export interface DecimatedSeries {
	x: Float64Array;
	y: Float64Array;
	/** True when the visible window was rendered without bucketing. */
	fullDetail: boolean;
	buckets: number;
}

export interface VisibleStats {
	count: number;
	min: number;
	max: number;
	first: number;
	last: number;
	/** First index with x >= from. */
	start: number;
	/** First index with x > to. */
	end: number;
}

type Sequence = ArrayLike<number>;

function sliceRange(sequence: Sequence, start: number, end: number): Float64Array {
	if (sequence instanceof Float64Array) return sequence.subarray(start, end);
	const result = new Float64Array(end - start);
	for (let index = start; index < end; index += 1) result[index - start] = sequence[index];
	return result;
}

/** First index whose value is >= target. */
export function lowerBound(x: Sequence, target: number): number {
	let low = 0;
	let high = x.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (x[middle] < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** First index whose value is > target. */
export function upperBound(x: Sequence, target: number): number {
	let low = 0;
	let high = x.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (x[middle] <= target) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function maxSamplesForWidth(pixelWidth: number): number {
	return Math.max(2, Math.ceil(pixelWidth * VIEW_SAMPLES_PER_PIXEL) + 2);
}

/** True when the visible sample count fits the per-pixel budget. */
export function isFullDetail(count: number, pixelWidth: number): boolean {
	return count <= maxSamplesForWidth(pixelWidth);
}

/**
 * Probes for an evenly spaced window, within a tolerance far below one
 * bucket width. Adaptive timesteps fall back to the x-indexed path.
 */
function isUniformGrid(x: Sequence, start: number, end: number): boolean {
	const count = end - start;
	if (count < 3) return true;
	const first = x[start];
	const last = x[end - 1];
	const step = (last - first) / (count - 1);
	if (!(step > 0)) return false;
	const tolerance = Math.max(step * 0.01, (last - first) * 1e-9);
	for (let probe = 1; probe <= 8; probe += 1) {
		const index = start + Math.floor(((count - 1) * probe) / 9) + 1;
		if (index >= end) break;
		const delta = x[index] - x[index - 1];
		if (Math.abs(delta - step) > tolerance) return false;
	}
	return true;
}

/**
 * Min/max bucket decimation. Each bucket contributes its minimum and maximum
 * sample (in original order), so narrow peaks survive, and the window
 * endpoints anchor the polyline. Cost is linear in the visible samples.
 */
export function decimateMinMax(
	x: Sequence,
	y: Sequence,
	from: number,
	to: number,
	pixelWidth: number
): DecimatedSeries {
	if (x.length !== y.length) {
		throw new Error(`x and y must have the same length, got ${x.length} and ${y.length}`);
	}
	if (!(pixelWidth >= 1)) {
		throw new Error(`pixelWidth must be at least 1, got ${pixelWidth}`);
	}
	if (x.length === 0 || !(to > from)) {
		return { x: new Float64Array(0), y: new Float64Array(0), fullDetail: true, buckets: 0 };
	}
	const start = lowerBound(x, from);
	const end = upperBound(x, to);
	const count = end - start;
	if (count <= 0) {
		return { x: new Float64Array(0), y: new Float64Array(0), fullDetail: true, buckets: 0 };
	}
	if (isFullDetail(count, pixelWidth)) {
		return {
			x: sliceRange(x, start, end),
			y: sliceRange(y, start, end),
			fullDetail: true,
			buckets: 0
		};
	}

	const buckets = Math.max(1, Math.floor(pixelWidth));
	const minIndex = new Int32Array(buckets).fill(-1);
	const maxIndex = new Int32Array(buckets).fill(-1);
	const x0 = x[start];
	const x1 = x[end - 1];
	const span = x1 - x0;
	// Uniform grids (the solver's output grid) bucket by sample index, which
	// keeps the hot loop free of per-point axis reads and divisions.
	if (isUniformGrid(x, start, end)) {
		const perBucket = count / buckets;
		let index = start;
		while (index < end) {
			const bucket = Math.min(buckets - 1, ((index - start) / perBucket) | 0);
			const next = Math.max(
				index + 1,
				Math.min(end, start + Math.ceil((bucket + 1) * perBucket))
			);
			let minValue = Number.POSITIVE_INFINITY;
			let maxValue = Number.NEGATIVE_INFINITY;
			let minAt = -1;
			let maxAt = -1;
			for (; index < next; index += 1) {
				const value = y[index];
				if (value !== value) continue;
				if (value < minValue) {
					minValue = value;
					minAt = index;
				}
				if (value > maxValue) {
					maxValue = value;
					maxAt = index;
				}
			}
			minIndex[bucket] = minAt;
			maxIndex[bucket] = maxAt;
		}
	} else {
		const scale = span > 0 ? buckets / span : 0;
		for (let index = start; index < end; index += 1) {
			const value = y[index];
			if (!Number.isFinite(value)) continue;
			const bucket =
				span > 0 ? Math.min(buckets - 1, ((x[index] - x0) * scale) | 0) : 0;
			const min = minIndex[bucket];
			if (min === -1 || value < y[min]) minIndex[bucket] = index;
			const max = maxIndex[bucket];
			if (max === -1 || value > y[max]) maxIndex[bucket] = index;
		}
	}

	const outX: number[] = [];
	const outY: number[] = [];
	const push = (index: number): void => {
		const px = x[index];
		const py = y[index];
		const last = outX.length - 1;
		if (last >= 0 && outX[last] === px && outY[last] === py) return;
		outX.push(px);
		outY.push(py);
	};
	for (let bucket = 0; bucket < buckets; bucket += 1) {
		const min = minIndex[bucket];
		const max = maxIndex[bucket];
		if (min === -1) continue;
		if (min === max) {
			push(min);
			continue;
		}
		const [firstIndex, secondIndex] = min < max ? [min, max] : [max, min];
		push(firstIndex);
		push(secondIndex);
	}
	if (Number.isFinite(y[start]) && (outX.length === 0 || outX[0] > x[start])) {
		outX.unshift(x[start]);
		outY.unshift(y[start]);
	}
	if (Number.isFinite(y[end - 1]) && (outX.length === 0 || outX[outX.length - 1] < x[end - 1])) {
		outX.push(x[end - 1]);
		outY.push(y[end - 1]);
	}
	return {
		x: Float64Array.from(outX),
		y: Float64Array.from(outY),
		fullDetail: false,
		buckets
	};
}

/** Min/max/first/last over a visible window, in one pass. */
export function visibleStats(
	x: Sequence,
	y: Sequence,
	from: number,
	to: number
): VisibleStats | null {
	if (x.length !== y.length) {
		throw new Error(`x and y must have the same length, got ${x.length} and ${y.length}`);
	}
	const start = lowerBound(x, from);
	const end = upperBound(x, to);
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let first = Number.NaN;
	let last = Number.NaN;
	let count = 0;
	for (let index = start; index < end; index += 1) {
		const value = y[index];
		if (!Number.isFinite(value)) continue;
		if (count === 0) first = value;
		last = value;
		count += 1;
		if (value < min) min = value;
		if (value > max) max = value;
	}
	if (count === 0) return null;
	return { count, min, max, first, last, start, end };
}

/** Linear-interpolated sample lookup for cursor readouts. */
export function sampleAt(x: Sequence, y: Sequence, at: number): number | null {
	if (x.length === 0 || !Number.isFinite(at) || at < x[0] || at > x[x.length - 1]) return null;
	const index = upperBound(x, at) - 1;
	if (index < 0) return null;
	if (index >= x.length - 1 || x[index] === at) return y[index];
	const span = x[index + 1] - x[index];
	if (!(span > 0)) return y[index];
	const fraction = (at - x[index]) / span;
	return y[index] + (y[index + 1] - y[index]) * fraction;
}
