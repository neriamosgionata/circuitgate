import { CompileError } from '../compile';
import type { LogicValue } from '../values';

export const MAX_WORD_BITS = 32;

export function bitPins(prefix: string, width: number): string[] {
	const pins: string[] = [];
	for (let index = 0; index < width; index++) pins.push(`${prefix}${index}`);
	return pins;
}

export function requirePositiveInteger(
	value: number,
	label: string,
	code = 'invalid-primitive-parameter'
): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new CompileError(`${label} must be a positive integer, got ${value}`, code);
	}
}

export function requireWordWidth(wordBits: number, label = 'wordBits'): void {
	requirePositiveInteger(wordBits, label);
	if (wordBits > MAX_WORD_BITS) {
		throw new CompileError(`${label} must be at most ${MAX_WORD_BITS}, got ${wordBits}`, 'invalid-primitive-parameter');
	}
}

export function bitsToIndex(values: readonly LogicValue[]): number | undefined {
	let index = 0;
	for (let position = 0; position < values.length; position++) {
		const bit = values[position];
		if (bit !== 0 && bit !== 1) return undefined;
		index |= (bit as number) << position;
	}
	return index;
}

export function numberToBits(value: number, width: number): LogicValue[] {
	const bits: LogicValue[] = [];
	for (let index = 0; index < width; index++) bits.push(((value >> index) & 1) as LogicValue);
	return bits;
}

export function unknownBits(width: number): LogicValue[] {
	return new Array<LogicValue>(width).fill('X');
}
