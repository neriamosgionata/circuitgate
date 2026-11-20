import { formatSI } from './analog/si';

/** Integer time quantum used by the physical scheduler. */
export const PS_PER_NS = 1000;

/**
 * Convert nanoseconds to the integer picosecond time base.
 *
 * Zero stays zero so ideal parts can settle in the delta subloop. A positive
 * value below half a picosecond rounds to zero, so it is lifted to the minimum
 * representable step instead of disappearing.
 */
export function nsToPs(ns: number): number {
	if (!Number.isFinite(ns) || ns < 0) {
		throw new Error(`nanoseconds must be a finite non-negative number, got ${ns}`);
	}
	if (ns === 0) return 0;
	return Math.max(1, Math.round(ns * PS_PER_NS));
}

export function psToNs(ps: number): number {
	if (!Number.isFinite(ps) || ps < 0) {
		throw new Error(`picoseconds must be a finite non-negative number, got ${ps}`);
	}
	return ps / PS_PER_NS;
}

/** Format an integer picosecond timestamp as an SI time string (for example `20ns`). */
export function formatTimePs(ps: number): string {
	if (!Number.isFinite(ps)) return '';
	return `${formatSI(ps / 1e12)}s`;
}
