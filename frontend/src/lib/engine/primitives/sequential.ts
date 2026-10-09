import { CompileError, type ComponentKind } from '../compile';
import { risingEdgeDetected } from './flipflops';
import { bitPins, numberToBits, requireWordWidth, unknownBits } from './pins';
import type { LogicValue } from '../values';

interface WordState {
	bits: LogicValue[];
	lastClk: LogicValue;
}

function previousBits(state: unknown, width: number): LogicValue[] {
	const stored = (state as WordState | undefined)?.bits;
	if (stored !== undefined) {
		if (stored.length !== width) {
			throw new CompileError(
				`sequential state width does not match kind width ${width}`,
				'invalid-sequential-state'
			);
		}
		return [...stored];
	}
	return unknownBits(width);
}

function isBinary(value: LogicValue): value is 0 | 1 {
	return value === 0 || value === 1;
}

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

// Up counter with synchronous reset, enable, and parallel load. Bit 0 is the
// least significant. A non-binary control level drives every output X; data
// bits pass through as-is on load.
export function counterKind(width: number): ComponentKind {
	requireWordWidth(width, 'counter width');
	const dataPins = bitPins('d', width);
	return {
		inputs: ['clk', 'reset', 'enable', 'load', ...dataPins],
		outputs: bitPins('q', width),
		evaluate: (inputs, state) => {
			const previous = state as WordState | undefined;
			const held = previousBits(state, width);
			const [clk, reset, enable, load] = inputs;
			const data = inputs.slice(4, 4 + width);
			let bits = held;
			if (risingEdgeDetected(previous?.lastClk, clk)) {
				if (reset === 1) {
					bits = new Array<LogicValue>(width).fill(0);
				} else if (!isBinary(reset) || !isBinary(enable) || !isBinary(load)) {
					bits = unknownBits(width);
				} else if (load === 1) {
					bits = [...data];
				} else if (enable === 1) {
					bits = incrementBits(held);
				}
			}
			return { outputs: [...bits], state: { bits: [...bits], lastClk: clk } };
		}
	};
}

// Serial-in shift register with synchronous reset and parallel load. On each
// rising edge the register shifts toward the most significant bit: q0 takes
// the serial input and every other bit takes its lower neighbor. A non-binary
// control level drives every output X.
export function shiftRegisterKind(width: number): ComponentKind {
	requireWordWidth(width, 'shift register width');
	const dataPins = bitPins('d', width);
	return {
		inputs: ['clk', 'reset', 'load', 'sin', ...dataPins],
		outputs: bitPins('q', width),
		evaluate: (inputs, state) => {
			const previous = state as WordState | undefined;
			const held = previousBits(state, width);
			const [clk, reset, load, sin] = inputs;
			const data = inputs.slice(4, 4 + width);
			let bits = held;
			if (risingEdgeDetected(previous?.lastClk, clk)) {
				if (reset === 1) {
					bits = new Array<LogicValue>(width).fill(0);
				} else if (!isBinary(reset) || !isBinary(load)) {
					bits = unknownBits(width);
				} else if (load === 1) {
					bits = [...data];
				} else {
					bits = held.map((_, index) => (index === 0 ? sin : held[index - 1]));
				}
			}
			return { outputs: [...bits], state: { bits: [...bits], lastClk: clk } };
		}
	};
}
