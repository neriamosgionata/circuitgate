import { describe, expect, it } from 'vitest';
import {
	ANALOG_TOLERANCES,
	relativeError,
	toDecibels,
	withinAbsolute,
	withinRange,
	withinRelative
} from '../tolerance';

describe('KTD5 analog tolerance targets', () => {
	it('exposes the KTD5 numeric targets', () => {
		expect(ANALOG_TOLERANCES.opLinear).toBe(0.01);
		expect(ANALOG_TOLERANCES.opNonlinear).toBe(0.05);
		expect(ANALOG_TOLERANCES.tranSample).toBe(0.02);
		expect(ANALOG_TOLERANCES.tranTimeConstant).toBe(0.02);
		expect(ANALOG_TOLERANCES.acCorner).toBe(0.02);
		expect(ANALOG_TOLERANCES.acMagnitudeDb).toBe(0.5);
	});
});

describe('relativeError', () => {
	it('computes the relative error against a non-zero expected value', () => {
		expect(relativeError(6.0, 6.0)).toBe(0);
		expect(relativeError(6.06, 6.0)).toBeCloseTo(0.01, 12);
		expect(relativeError(5.94, 6.0)).toBeCloseTo(0.01, 12);
	});

	it('uses the expected magnitude so sign does not matter', () => {
		expect(relativeError(-1.01, -1.0)).toBeCloseTo(0.01, 12);
		expect(relativeError(-1.01, 1.0)).toBeCloseTo(2.01, 12);
	});

	it('returns Infinity when the expected value is zero but the actual is not', () => {
		expect(relativeError(1e-9, 0)).toBe(Infinity);
		expect(relativeError(0, 0)).toBe(0);
	});
});

describe('withinRelative', () => {
	it('accepts values inside the tolerance and rejects values outside', () => {
		expect(withinRelative(6.06, 6.0, ANALOG_TOLERANCES.opLinear)).toBe(true);
		expect(withinRelative(6.061, 6.0, ANALOG_TOLERANCES.opLinear)).toBe(false);
	});

	it('accepts values exactly on the boundary', () => {
		expect(withinRelative(6.06, 6.0, 0.01)).toBe(true);
		expect(withinRelative(5.94, 6.0, 0.01)).toBe(true);
	});

	it('handles the zero-expected case', () => {
		expect(withinRelative(0, 0, ANALOG_TOLERANCES.opLinear)).toBe(true);
		expect(withinRelative(0.001, 0, ANALOG_TOLERANCES.opLinear)).toBe(false);
	});

	it('bounds transient and AC corner targets', () => {
		expect(withinRelative(102, 100, ANALOG_TOLERANCES.tranTimeConstant)).toBe(true);
		expect(withinRelative(103, 100, ANALOG_TOLERANCES.tranTimeConstant)).toBe(false);
		expect(withinRelative(1621.8, 1590, ANALOG_TOLERANCES.acCorner)).toBe(true);
	});
});

describe('withinAbsolute', () => {
	it('checks the AC magnitude target in decibels', () => {
		expect(withinAbsolute(-3.0, -3.01, ANALOG_TOLERANCES.acMagnitudeDb)).toBe(true);
		expect(withinAbsolute(-3.6, -3.01, ANALOG_TOLERANCES.acMagnitudeDb)).toBe(false);
	});
});

describe('withinRange', () => {
	it('checks the datasheet-typical diode forward drop range', () => {
		expect(withinRange(0.7, 0.6, 0.8)).toBe(true);
		expect(withinRange(0.55, 0.6, 0.8)).toBe(false);
		expect(withinRange(0.81, 0.6, 0.8)).toBe(false);
		expect(withinRange(0.6, 0.6, 0.8)).toBe(true);
		expect(withinRange(0.8, 0.6, 0.8)).toBe(true);
	});
});

describe('toDecibels', () => {
	it('converts magnitude ratios to decibels', () => {
		expect(toDecibels(1)).toBe(0);
		expect(toDecibels(10)).toBeCloseTo(20, 12);
		expect(toDecibels(0.5)).toBeCloseTo(-6.0206, 3);
		expect(toDecibels(-0.5)).toBeCloseTo(-6.0206, 3);
	});
});
