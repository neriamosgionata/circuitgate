import type { ComponentKind } from '../compile';
import { and, or, xor, type LogicValue } from '../values';
import { bitPins, requirePositiveInteger, type Pinout } from './pins';

export function halfAdderCompute(a: LogicValue, b: LogicValue): [LogicValue, LogicValue] {
	return [xor(a, b), and(a, b)];
}

export function fullAdderCompute(a: LogicValue, b: LogicValue, cin: LogicValue): [LogicValue, LogicValue] {
	const propagate = xor(a, b);
	const sum = xor(propagate, cin);
	const cout = or(and(a, b), and(propagate, cin));
	return [sum, cout];
}

export const halfAdder: ComponentKind = {
	inputs: ['a', 'b'],
	outputs: ['sum', 'carry'],
	evaluate: ([a, b]) => ({ outputs: halfAdderCompute(a, b) })
};

export const fullAdder: ComponentKind = {
	inputs: ['a', 'b', 'cin'],
	outputs: ['sum', 'cout'],
	evaluate: ([a, b, cin]) => ({ outputs: fullAdderCompute(a, b, cin) })
};

export function rippleCarryAdderPins(width: number): Pinout {
	requirePositiveInteger(width, 'adder width');
	return {
		inputs: [...bitPins('a', width), ...bitPins('b', width), 'cin'],
		outputs: [...bitPins('s', width), 'cout']
	};
}

// Ripple-carry adder assembled from full adders: bit 0 is the least
// significant, and the carry propagates from bit i to bit i+1.
export function rippleCarryAdderKind(width: number): ComponentKind {
	const { inputs, outputs } = rippleCarryAdderPins(width);
	return {
		inputs,
		outputs,
		evaluate: (values) => {
			const a = values.slice(0, width);
			const b = values.slice(width, width * 2);
			let carry = values[width * 2];
			const sums: LogicValue[] = [];
			for (let index = 0; index < width; index++) {
				const [sum, nextCarry] = fullAdderCompute(a[index], b[index], carry);
				sums.push(sum);
				carry = nextCarry;
			}
			return { outputs: [...sums, carry] };
		}
	};
}

export function magnitudeComparatorPins(width: number): Pinout {
	requirePositiveInteger(width, 'comparator width');
	return {
		inputs: [...bitPins('a', width), ...bitPins('b', width)],
		outputs: ['eq', 'gt', 'lt']
	};
}

// Magnitude comparator. Bits are compared from the most significant down; an
// unknown bit makes every output X unless a higher bit already decided.
export function magnitudeComparatorKind(width: number): ComponentKind {
	const { inputs, outputs } = magnitudeComparatorPins(width);
	return {
		inputs,
		outputs,
		evaluate: (values) => {
			const a = values.slice(0, width);
			const b = values.slice(width, width * 2);
			let decision: 'eq' | 'gt' | 'lt' | 'unknown' = 'eq';
			for (let index = width - 1; index >= 0; index--) {
				const aBit = a[index];
				const bBit = b[index];
				if (aBit === 0 && bBit === 0) continue;
				if (aBit === 1 && bBit === 1) continue;
				if (aBit === 1 && bBit === 0) {
					decision = 'gt';
					break;
				}
				if (aBit === 0 && bBit === 1) {
					decision = 'lt';
					break;
				}
				decision = 'unknown';
				break;
			}
			const outputs: LogicValue[] =
				decision === 'eq'
					? [1, 0, 0]
					: decision === 'gt'
						? [0, 1, 0]
						: decision === 'lt'
							? [0, 0, 1]
							: ['X', 'X', 'X'];
			return { outputs };
		}
	};
}
