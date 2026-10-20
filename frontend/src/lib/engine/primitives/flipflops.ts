import type { ComponentKind } from '../compile';
import { not, type LogicValue } from '../values';
import { bitPins, requirePositiveInteger, type Pinout } from './pins';
import { commitWord, previousWord, risingEdgeDetected, type WordState } from './state';

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
export function registerPins(width: number): Pinout {
	requirePositiveInteger(width, 'register width');
	return { inputs: ['clk', ...bitPins('d', width)], outputs: bitPins('q', width) };
}

export function registerKind(width: number): ComponentKind {
	const { inputs, outputs } = registerPins(width);
	return {
		inputs,
		outputs,
		evaluate: (values, state) => {
			const previous = state as WordState | undefined;
			const held = previousWord(state, width, 'invalid-register-state', 'register state');
			const clk = values[0];
			const bits = risingEdgeDetected(previous?.lastClk, clk)
				? values.slice(1, 1 + width)
				: held;
			return { outputs: [...bits], state: commitWord(bits, clk) };
		}
	};
}
