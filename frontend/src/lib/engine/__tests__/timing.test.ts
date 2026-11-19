import { describe, expect, it } from 'vitest';
import { CompileError } from '../compile';
import { defaultParamsForKind, PARAMETERIZED_FAMILY_KINDS } from '../kinds';
import {
	formatTimePs,
	nsToPs,
	PS_PER_NS,
	psToNs
} from '../time';
import {
	isTimingParam,
	timingDefaultsForKind,
	timingFieldsForKind,
	timingForComponent,
	validateTimingParam
} from '../timing';

describe('time conversion', () => {
	it('converts nanoseconds to integer picoseconds', () => {
		expect(PS_PER_NS).toBe(1000);
		expect(nsToPs(0)).toBe(0);
		expect(nsToPs(0.5)).toBe(500);
		expect(nsToPs(2.5)).toBe(2500);
		expect(nsToPs(0.0001)).toBe(1);
		expect(psToNs(2500)).toBe(2.5);
	});

	it('rejects negative and non-finite time values', () => {
		expect(() => nsToPs(-1)).toThrow();
		expect(() => nsToPs(Number.NaN)).toThrow();
		expect(() => psToNs(-1)).toThrow();
	});

	it('formats picosecond timestamps with SI units', () => {
		expect(formatTimePs(0)).toBe('0s');
		expect(formatTimePs(20_000)).toBe('20ns');
		expect(formatTimePs(500)).toBe('500ps');
	});
});

describe('timing defaults and fields', () => {
	it('uses the planned defaults for each timing-bearing group', () => {
		expect(timingDefaultsForKind('and').delayPs).toBe(2000);
		expect(timingDefaultsForKind('mux2').delayPs).toBe(3000);
		expect(timingDefaultsForKind('sevenSegDecoder').delayPs).toBe(3000);
		expect(timingDefaultsForKind('halfAdder').delayPs).toBe(3000);
		expect(timingDefaultsForKind('fullAdder').delayPs).toBe(4000);
		expect(timingDefaultsForKind('rippleCarryAdder').delayPs).toBe(6000);
		expect(timingDefaultsForKind('magnitudeComparator').delayPs).toBe(6000);
		expect(timingDefaultsForKind('dFlipFlop')).toMatchObject({
			clockToQPs: 4000,
			setupPs: 2000,
			holdPs: 1000,
			sequential: true
		});
		expect(timingDefaultsForKind('srLatch').delayPs).toBe(2000);
		expect(timingDefaultsForKind('clock')).toMatchObject({ periodPs: 20_000, duty: 0.5, clock: true });
	});

	it('treats memory, sinks, switches, and unknown kinds as zero-delay', () => {
		for (const kind of ['switch', 'probe', 'led', 'sevenSegDisplay', 'ram', 'rom', 'registerFile', 'unknown']) {
			expect(timingDefaultsForKind(kind).delayPs, kind).toBe(0);
			expect(timingFieldsForKind(kind), kind).toEqual([]);
		}
	});

	it('lists only the fields that apply to a kind', () => {
		expect(timingFieldsForKind('and')).toEqual(['delay']);
		expect(timingFieldsForKind('srLatch')).toEqual(['delay']);
		expect(timingFieldsForKind('dFlipFlop')).toEqual(['clockToQ', 'setup', 'hold']);
		expect(timingFieldsForKind('register')).toEqual(['clockToQ', 'setup', 'hold']);
		expect(timingFieldsForKind('clock')).toEqual(['period', 'duty']);
		expect(timingFieldsForKind('ram')).toEqual([]);
	});
});

describe('timing overrides', () => {
	it('merges explicit overrides into the kind defaults', () => {
		expect(timingForComponent('and', { delay: 2.5 }).delayPs).toBe(2500);
		expect(timingForComponent('register', { clockToQ: 3, setup: 1.5, hold: 0.5 })).toMatchObject({
			clockToQPs: 3000,
			setupPs: 1500,
			holdPs: 500
		});
		expect(timingForComponent('clock', { period: 25, duty: 40 })).toMatchObject({
			periodPs: 25_000,
			duty: 0.4
		});
		expect(timingForComponent('and', { delay: 0 }).delayPs).toBe(0);
	});

	it('does not copy timing defaults into parameterized family defaults', () => {
		for (const family of PARAMETERIZED_FAMILY_KINDS) {
			const params = defaultParamsForKind(family);
			expect(params, family).not.toBeNull();
			expect(Object.keys(params ?? {}).some((key) => isTimingParam(key)), family).toBe(false);
		}
	});

	it('rejects timing keys that do not apply to the kind', () => {
		expect(() => timingForComponent('register', { delay: 1 })).toThrow(CompileError);
		expect(() => timingForComponent('ram', { delay: 1 })).toThrow(CompileError);
		expect(() => timingForComponent('clock', { clockToQ: 1 })).toThrow(CompileError);
	});

	it('rejects invalid timing values with compile errors', () => {
		expect(() => timingForComponent('and', { delay: -1 })).toThrow(CompileError);
		expect(() => timingForComponent('and', { delay: '2' })).toThrow(CompileError);
		expect(() => timingForComponent('clock', { period: 0 })).toThrow(CompileError);
		expect(() => timingForComponent('clock', { duty: 0 })).toThrow(CompileError);
		expect(() => timingForComponent('clock', { duty: 100 })).toThrow(CompileError);
		expect(() => timingForComponent('dFlipFlop', { setup: Number.NaN })).toThrow(CompileError);
	});

	it('validates timing params for the store and Inspector', () => {
		expect(validateTimingParam('and', 'delay', 2)).toEqual({ ok: true, value: 2 });
		expect(validateTimingParam('clock', 'duty', 50)).toEqual({ ok: true, value: 50 });
		expect(validateTimingParam('clock', 'duty', 0).ok).toBe(false);
		expect(validateTimingParam('register', 'delay', 1).ok).toBe(false);
		expect(validateTimingParam('and', 'delay', '2').ok).toBe(false);
	});
});
