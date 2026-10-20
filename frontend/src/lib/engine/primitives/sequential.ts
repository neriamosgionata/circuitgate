import type { ComponentKind } from '../compile';
import { bitPins, requireWordWidth, unknownBits, zeroBits, type Pinout } from './pins';
import { commitWord, isBinary, previousWord, risingEdgeDetected, type WordState } from './state';
import type { LogicValue } from '../values';

function incrementBits(bits: readonly LogicValue[]): LogicValue[] {
	let carry: LogicValue = 1;
	const next: LogicValue[] = [];
	for (const bit of bits) {
		if (!isBinary(bit) || !isBinary(carry)) {
			next.push('X');
			carry = 'X';
			continue;
		}
		next.push(((bit + carry) & 1) as LogicValue);
		carry = bit === 1 && carry === 1 ? 1 : 0;
	}
	return next;
}

export function counterPins(width: number): Pinout {
	requireWordWidth(width, 'counter width');
	return {
		inputs: ['clk', 'reset', 'enable', 'load', ...bitPins('d', width)],
		outputs: bitPins('q', width)
	};
}

// Up counter with synchronous reset, enable, and parallel load. Bit 0 is the
// least significant. A non-binary control level drives every output X; data
// bits pass through as-is on load.
export function counterKind(width: number): ComponentKind {
	const { inputs, outputs } = counterPins(width);
	return {
		inputs,
		outputs,
		evaluate: (values, state) => {
			const previous = state as WordState | undefined;
			const held = previousWord(state, width, 'invalid-sequential-state');
			const [clk, reset, enable, load] = values;
			const data = values.slice(4, 4 + width);
			let bits = held;
			if (risingEdgeDetected(previous?.lastClk, clk)) {
				if (reset === 1) {
					bits = zeroBits(width);
				} else if (!isBinary(reset) || !isBinary(enable) || !isBinary(load)) {
					bits = unknownBits(width);
				} else if (load === 1) {
					bits = [...data];
				} else if (enable === 1) {
					bits = incrementBits(held);
				}
			}
			return { outputs: [...bits], state: commitWord(bits, clk) };
		}
	};
}

export function shiftRegisterPins(width: number): Pinout {
	requireWordWidth(width, 'shift register width');
	return {
		inputs: ['clk', 'reset', 'load', 'sin', ...bitPins('d', width)],
		outputs: bitPins('q', width)
	};
}

// Serial-in shift register with synchronous reset and parallel load. On each
// rising edge the register shifts toward the most significant bit: q0 takes
// the serial input and every other bit takes its lower neighbor. A non-binary
// control level drives every output X.
export function shiftRegisterKind(width: number): ComponentKind {
	const { inputs, outputs } = shiftRegisterPins(width);
	return {
		inputs,
		outputs,
		evaluate: (values, state) => {
			const previous = state as WordState | undefined;
			const held = previousWord(state, width, 'invalid-sequential-state');
			const [clk, reset, load, sin] = values;
			const data = values.slice(4, 4 + width);
			let bits = held;
			if (risingEdgeDetected(previous?.lastClk, clk)) {
				if (reset === 1) {
					bits = zeroBits(width);
				} else if (!isBinary(reset) || !isBinary(load)) {
					bits = unknownBits(width);
				} else if (load === 1) {
					bits = [...data];
				} else {
					bits = held.map((_, index) => (index === 0 ? sin : held[index - 1]));
				}
			}
			return { outputs: [...bits], state: commitWord(bits, clk) };
		}
	};
}
