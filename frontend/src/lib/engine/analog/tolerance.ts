/**
 * KTD5 numeric acceptance targets for the analog engine, shared by unit and
 * end-to-end assertions. Values are fractional tolerances unless the name says
 * otherwise.
 */
export const ANALOG_TOLERANCES = {
	/** Linear operating-point node voltages, against analytic values. */
	opLinear: 0.01,
	/** Nonlinear operating-point bias values against hand calculation. */
	opNonlinear: 0.05,
	/** Transient sampled values against the analytic solution. */
	tranSample: 0.02,
	/** Transient time constants. */
	tranTimeConstant: 0.02,
	/** AC corner frequencies. */
	acCorner: 0.02,
	/** AC magnitudes, in decibels. */
	acMagnitudeDb: 0.5
} as const;

/** Fractional error of `actual` against `expected`, using the expected magnitude. */
export function relativeError(actual: number, expected: number): number {
	const magnitude = Math.abs(expected);
	if (magnitude === 0) return actual === 0 ? 0 : Infinity;
	return Math.abs(actual - expected) / magnitude;
}

export function withinRelative(actual: number, expected: number, tolerance: number): boolean {
	return relativeError(actual, expected) <= tolerance;
}

export function withinAbsolute(actual: number, expected: number, tolerance: number): boolean {
	return Math.abs(actual - expected) <= tolerance;
}

export function withinRange(actual: number, min: number, max: number): boolean {
	return actual >= min && actual <= max;
}

export function toDecibels(magnitude: number): number {
	return 20 * Math.log10(Math.abs(magnitude));
}
