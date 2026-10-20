import { CompileError } from '../compile';
import type { LogicValue } from '../values';
import { unknownBits } from './pins';

// Clock-edge convention (delta-cycle mode).
//
// The engine has no global time in settle(): a component sees a stream of
// delta-cycle evaluations. Sequential kinds therefore keep the previous clock
// level in their own state and treat a transition from a known 0 to a known 1
// as a rising edge, detected on the first delta cycle that observes it. The
// sampled data is the value present in that delta cycle; later delta cycles in
// the same settle pass see the committed clock level and do not re-sample.
// An undefined or X previous level is never an edge, so power-up with the clock
// already high does not latch. This makes sequential behavior deterministic and
// identical in settle() and runTimed().
export function risingEdgeDetected(lastClk: LogicValue | undefined, clk: LogicValue): boolean {
	return lastClk === 0 && clk === 1;
}

export interface WordState {
	bits: LogicValue[];
	lastClk: LogicValue;
}

/** Previous word for a clocked component, or all-unknown on first evaluation. */
export function previousWord(
	state: unknown,
	width: number,
	code: string,
	label = 'sequential state'
): LogicValue[] {
	const stored = (state as WordState | undefined)?.bits;
	if (stored === undefined) return unknownBits(width);
	if (stored.length !== width) {
		throw new CompileError(`${label} width does not match kind width ${width}`, code);
	}
	return [...stored];
}

/** Commit a word and the clock level that produced it. */
export function commitWord(bits: readonly LogicValue[], clk: LogicValue): WordState {
	return { bits: [...bits], lastClk: clk };
}

export function isBinary(value: LogicValue): value is 0 | 1 {
	return value === 0 || value === 1;
}
