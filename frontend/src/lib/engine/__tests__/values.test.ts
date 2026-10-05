import { describe, expect, it } from 'vitest';
import { and, not, or, resolveDrivers, xor } from '../values';
import type { LogicValue } from '../values';

const binary = (fn: (a: LogicValue, b: LogicValue) => LogicValue, expected: Array<[LogicValue, LogicValue, LogicValue]>) => {
	for (const [a, b, out] of expected) {
		expect(fn(a, b)).toBe(out);
	}
};

describe('four-state value algebra', () => {
	it('AND truth table over 0/1', () => {
		binary(and, [
			[0, 0, 0],
			[0, 1, 0],
			[1, 0, 0],
			[1, 1, 1]
		]);
	});

	it('AND with unknown follows dominance of 0', () => {
		binary(and, [
			[0, 'X', 0],
			['X', 0, 0],
			[1, 'X', 'X'],
			['X', 1, 'X'],
			['X', 'X', 'X']
		]);
	});

	it('OR truth table over 0/1', () => {
		binary(or, [
			[0, 0, 0],
			[0, 1, 1],
			[1, 0, 1],
			[1, 1, 1]
		]);
	});

	it('OR with unknown follows dominance of 1', () => {
		binary(or, [
			[1, 'X', 1],
			['X', 1, 1],
			[0, 'X', 'X'],
			['X', 0, 'X']
		]);
	});

	it('XOR truth table over 0/1 and unknown', () => {
		binary(xor, [
			[0, 0, 0],
			[0, 1, 1],
			[1, 0, 1],
			[1, 1, 0],
			[0, 'X', 'X'],
			['X', 1, 'X']
		]);
	});

	it('NOT inverts known values and propagates unknown', () => {
		expect(not(0)).toBe(1);
		expect(not(1)).toBe(0);
		expect(not('X')).toBe('X');
	});

	it('high-impedance behaves as unknown at gate inputs', () => {
		expect(and(1, 'Z')).toBe('X');
		expect(or(0, 'Z')).toBe('X');
		expect(not('Z')).toBe('X');
		expect(xor('Z', 1)).toBe('X');
	});
});

describe('driver resolution', () => {
	it('an undriven net is high-impedance', () => {
		expect(resolveDrivers([])).toBe('Z');
		expect(resolveDrivers(['Z'])).toBe('Z');
	});

	it('agreeing drivers resolve to their value', () => {
		expect(resolveDrivers([0, 0])).toBe(0);
		expect(resolveDrivers([1, 1, 1])).toBe(1);
	});

	it('conflicting drivers resolve to unknown', () => {
		expect(resolveDrivers([0, 1])).toBe('X');
		expect(resolveDrivers([1, 0, 1])).toBe('X');
	});

	it('a single active driver dominates high-impedance', () => {
		expect(resolveDrivers([0, 'Z'])).toBe(0);
		expect(resolveDrivers(['Z', 1])).toBe(1);
	});

	it('unknown combines with any other value to unknown', () => {
		expect(resolveDrivers(['X', 0])).toBe('X');
		expect(resolveDrivers(['X', 'Z'])).toBe('X');
	});
});
