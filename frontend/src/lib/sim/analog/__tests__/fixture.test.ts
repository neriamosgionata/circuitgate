import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	fixtureToOutcomes,
	parseAnalogResultsFixture,
	type AnalogResultsFixture
} from '../fixture';

const FIXTURES = new URL('../../../../../tests/fixtures/analog-results/', import.meta.url);

function load(name: string): AnalogResultsFixture {
	const parsed = parseAnalogResultsFixture(
		JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as unknown
	);
	if (!parsed) throw new Error(`fixture ${name} failed to parse`);
	return parsed;
}

describe('analog result fixtures', () => {
	it('parses the transient fixture into typed variables and measurements', () => {
		const fixture = load('rc-clamp-tran.json');
		expect(fixture.lastCompletedKind).toBe('tran');
		expect(fixture.analyses).toHaveLength(1);
		const { outcomes, measurements } = fixtureToOutcomes(fixture);
		expect(outcomes[0].kind).toBe('tran');
		expect(outcomes[0].status).toBe('complete');
		const names = outcomes[0].variables.map((variable) => variable.name);
		expect(names).toEqual(['time', 'v(vin)', 'v(vout)']);
		expect(outcomes[0].variables[0].real).toBeInstanceOf(Float64Array);
		expect(outcomes[0].variables[0].real.length).toBe(10_001);
		expect(measurements).toHaveLength(2);
		expect(measurements[0].name).toBe('vout-rms');
		expect(measurements[0].status).toBe('complete');
		expect(measurements[0].value).toBeGreaterThan(0);
		expect(measurements[1].type).toBe('minmax');
		expect(measurements[1].min).toBeCloseTo(-0.65, 3);
	});

	it('parses the AC fixture with complex variables', () => {
		const fixture = load('rc-lowpass-ac.json');
		expect(fixture.lastCompletedKind).toBe('ac');
		const { outcomes } = fixtureToOutcomes(fixture);
		const variable = outcomes[0].variables.find((entry) => entry.name === 'v(vout)');
		expect(variable?.imag).toBeInstanceOf(Float64Array);
		expect(variable?.real.length).toBe(101);
		expect(variable?.imag?.length).toBe(101);
	});

	it('rejects malformed shapes instead of rendering them', () => {
		expect(parseAnalogResultsFixture(null)).toBeNull();
		expect(parseAnalogResultsFixture({ shapeVersion: 2, analyses: [] })).toBeNull();
		expect(parseAnalogResultsFixture({ shapeVersion: 1, analyses: 'nope' })).toBeNull();
		expect(
			parseAnalogResultsFixture({
				shapeVersion: 1,
				analyses: [{ id: 'x', kind: 'fourier', variables: [] }]
			})
		).toBeNull();
		expect(
			parseAnalogResultsFixture({
				shapeVersion: 1,
				analyses: [{ id: 'x', kind: 'tran', variables: [{ name: 'time', type: 'time' }] }]
			})
		).toBeNull();
	});

	it('carries failed analyses with diagnostics', () => {
		const fixture = parseAnalogResultsFixture({
			shapeVersion: 1,
			analyses: [
				{
					id: 'op1',
					kind: 'op',
					status: 'failed',
					diagnostic: { code: 'solver', message: 'solver failed' },
					variables: []
				}
			]
		});
		const { outcomes } = fixtureToOutcomes(fixture!);
		expect(outcomes[0].status).toBe('failed');
		expect(outcomes[0].diagnostic?.message).toBe('solver failed');
	});
});
