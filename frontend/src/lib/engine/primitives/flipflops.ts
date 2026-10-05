import { CompileError, type ComponentKind } from '../compile';
import { not, type LogicValue } from '../values';
import { bitPins, requirePositiveInteger, unknownBits } from './pins';

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

interface OutputState {
	q: LogicValue;
}

interface ClockedState extends OutputState {
	lastClk: LogicValue;
}

function initialQ(state: unknown): LogicValue {
	return (state as OutputState | undefined)?.q ?? 'X';
}

export const dFlipFlop: ComponentKind = {
	inputs: ['d', 'clk'],
	outputs: ['q', 'qn'],
	evaluate: ([d, clk], state) => {
		const previous = state as ClockedState | undefined;
		const q = risingEdgeDetected(previous?.lastClk, clk) ? d : initialQ(state);
		return { outputs: [q, not(q)], state: { q, lastClk: clk } };
	}
};

export const jkFlipFlop: ComponentKind = {
	inputs: ['j', 'k', 'clk'],
	outputs: ['q', 'qn'],
	evaluate: ([j, k, clk], state) => {
		const previous = state as ClockedState | undefined;
		let q = initialQ(state);
		if (risingEdgeDetected(previous?.lastClk, clk)) {
			if (j === 0 && k === 0) {
				q = initialQ(state);
			} else if (j === 0 && k === 1) {
				q = 0;
			} else if (j === 1 && k === 0) {
				q = 1;
			} else if (j === 1 && k === 1) {
				q = not(q);
			} else {
				q = 'X';
			}
		}
		return { outputs: [q, not(q)], state: { q, lastClk: clk } };
	}
};

// Level-sensitive SR latch. The both-high input combination is invalid; this
// implementation resolves it deterministically to a reset (q=0, qn=1), so
// releasing both inputs holds 0. qn is always the complement of q.
export const srLatch: ComponentKind = {
	inputs: ['s', 'r'],
	outputs: ['q', 'qn'],
	evaluate: ([s, r], state) => {
		let q = initialQ(state);
		if (s === 1 && r === 0) {
			q = 1;
		} else if (s === 0 && r === 1) {
			q = 0;
		} else if (s === 1 && r === 1) {
			q = 0;
		} else if (s === 0 && r === 0) {
			q = initialQ(state);
		} else {
			q = 'X';
		}
		return { outputs: [q, not(q)], state: { q } };
	}
};

export const srFlipFlop: ComponentKind = {
	inputs: ['s', 'r', 'clk'],
	outputs: ['q', 'qn'],
	evaluate: ([s, r, clk], state) => {
		const previous = state as ClockedState | undefined;
		let q = initialQ(state);
		if (risingEdgeDetected(previous?.lastClk, clk)) {
			if (s === 1 && r === 0) {
				q = 1;
			} else if (s === 0 && r === 1) {
				q = 0;
			} else if (s === 1 && r === 1) {
				q = 0;
			} else if (s === 0 && r === 0) {
				q = initialQ(state);
			} else {
				q = 'X';
			}
		}
		return { outputs: [q, not(q)], state: { q, lastClk: clk } };
	}
};

// Word registers use one pin per bit (d0..dN-1, q0..qN-1); the bit at index 0
// is the least significant. The engine has no bus values, so a word is a net
// group chosen by the caller.
export function registerKind(width: number): ComponentKind {
	requirePositiveInteger(width, 'register width');
	const dataPins = bitPins('d', width);
	return {
		inputs: ['clk', ...dataPins],
		outputs: bitPins('q', width),
		evaluate: (inputs, state) => {
			const previous = state as { bits?: LogicValue[]; lastClk?: LogicValue } | undefined;
			const previousBits = previous?.bits;
			if (previousBits !== undefined && previousBits.length !== width) {
				throw new CompileError(`register state width does not match kind width ${width}`, 'invalid-register-state');
			}
			const clk = inputs[0];
			const bits = risingEdgeDetected(previous?.lastClk, clk)
				? inputs.slice(1, 1 + width)
				: (previousBits ?? unknownBits(width));
			return { outputs: [...bits], state: { bits: [...bits], lastClk: clk } };
		}
	};
}
