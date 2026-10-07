import { describe, expect, it } from 'vitest';

import type { AnalogResultVariable } from '../protocol';
import {
	computeMeasurements,
	measurementUnit,
	signalUnitFor,
	type MeasurementDefinition,
	type MeasurementSource
} from '../measurements';

function sine(length: number, options: { dt?: number; amplitude?: number } = {}) {
	const dt = options.dt ?? 1e-6;
	const amplitude = options.amplitude ?? 1;
	const time = new Float64Array(length);
	const signal = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		time[index] = index * dt;
		signal[index] = amplitude * Math.sin(2 * Math.PI * 1000 * time[index]);
	}
	return { time, signal };
}

function transientSource(length = 2_000): MeasurementSource {
	const { time, signal } = sine(length);
	return {
		analysisId: 'tran1',
		variables: [
			{ name: 'time', type: 'time', real: time },
			{ name: 'v(out)', type: 'voltage', real: signal }
		]
	};
}

function definition(overrides: Partial<MeasurementDefinition> = {}): MeasurementDefinition {
	return {
		id: 'meas1',
		name: 'out',
		type: 'rms',
		signal: 'v(out)',
		...overrides
	};
}

describe('computeMeasurements', () => {
	it('computes RMS as the square root of the mean square', () => {
		const outcomes = computeMeasurements([definition()], [transientSource()]);
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].value).toBeCloseTo(1 / Math.SQRT2, 3);
		expect(outcomes[0].samples).toBe(2_000);
	});

	it('computes power as the mean square of the bound signal', () => {
		const outcomes = computeMeasurements([definition({ type: 'power' })], [transientSource()]);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].value).toBeCloseTo(0.5, 3);
	});

	it('reports min and max for a minmax measurement', () => {
		const outcomes = computeMeasurements([definition({ type: 'minmax' })], [transientSource()]);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].min).toBeCloseTo(-1, 2);
		expect(outcomes[0].max).toBeCloseTo(1, 2);
	});

	it('restricts values to the configured window', () => {
		const source = transientSource(2_000);
		const outcomes = computeMeasurements(
			[definition({ type: 'minmax', window: { start: 0, stop: 250e-6 } })],
			[source]
		);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].samples).toBe(251);
		expect(outcomes[0].max).toBeCloseTo(1, 2);
	});

	it('binds branch-current variables', () => {
		const time = new Float64Array([0, 1, 2, 3]);
		const current = new Float64Array([0, 1, 1, 0]);
		const outcomes = computeMeasurements(
			[definition({ signal: 'i(v1)', type: 'minmax' })],
			[
				{
					analysisId: 'tran1',
					variables: [
						{ name: 'time', type: 'time', real: time },
						{ name: 'i(v1)', type: 'current', real: current }
					]
				}
			]
		);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].max).toBe(1);
	});

	it('measures complex magnitudes for AC variables', () => {
		const frequency = new Float64Array([10, 100, 1000]);
		const real = new Float64Array([0, 0.6, 0]);
		const imag = new Float64Array([0, 0.8, 0]);
		const outcomes = computeMeasurements(
			[definition({ type: 'minmax' })],
			[
				{
					analysisId: 'ac1',
					variables: [
						{ name: 'frequency', type: 'frequency', real: frequency },
						{ name: 'v(out)', type: 'voltage', real, imag }
					]
				}
			]
		);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].max).toBeCloseTo(1, 6);
	});

	it('fails with an unbound diagnostic when the signal is absent', () => {
		const outcomes = computeMeasurements(
			[definition({ name: 'missing-signal', signal: 'v(nowhere)' })],
			[transientSource()]
		);
		expect(outcomes[0].status).toBe('failed');
		expect(outcomes[0].diagnostic?.code).toBe('unbound-measurement');
		expect(outcomes[0].diagnostic?.message).toContain('v(nowhere)');
		expect(outcomes[0].value).toBeUndefined();
	});

	it('skips sources that produced no variables', () => {
		const source = transientSource();
		const outcomes = computeMeasurements(
			[definition()],
			[{ analysisId: 'op1', variables: [] }, source]
		);
		expect(outcomes[0].status).toBe('complete');
		expect(outcomes[0].analysisId).toBe('meas1');
	});
});

describe('measurement units', () => {
	it('reads volts from node signals and amperes from branch currents', () => {
		expect(signalUnitFor('v(out)')).toBe('V');
		expect(signalUnitFor('V(SUPPLY)')).toBe('V');
		expect(signalUnitFor('i(v1)')).toBe('A');
		expect(signalUnitFor('time')).toBe('');
		expect(signalUnitFor('')).toBe('');
	});

	it('reports watts for power and the signal unit otherwise', () => {
		expect(measurementUnit('power', 'v(out)')).toBe('W');
		expect(measurementUnit('rms', 'v(out)')).toBe('V');
		expect(measurementUnit('rms', 'i(v1)')).toBe('A');
		expect(measurementUnit('minmax', 'v(out)')).toBe('V');
		expect(measurementUnit('rms', 'time')).toBe('');
	});
});
