import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ANALOG_TOLERANCES, relativeError, toDecibels, withinAbsolute, withinRange, withinRelative } from '../tolerance';
import {
	executeDeck,
	FIXTURES_DIR,
	findVariable,
	getCompileMs,
	lowPassCorner,
	magnitudes,
	realValues,
	runDeck,
	sampleAt,
	thevenin
} from './harness';

const fixture = (name: string): string => readFileSync(new URL(name, FIXTURES_DIR), 'utf8');

const V_T = 0.025864;
const RC_CORNER_HZ = 1 / (2 * Math.PI * 1e3 * 100e-9);
const RC_TAU_S = 100e-6;

const SPICE_SUFFIXES: Record<string, number> = {
	t: 1e12,
	g: 1e9,
	meg: 1e6,
	k: 1e3,
	m: 1e-3,
	u: 1e-6,
	n: 1e-9,
	p: 1e-12,
	f: 1e-15
};

function parseSpiceNumber(token: string): number {
	const match = token.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i);
	if (!match) throw new Error(`not a SPICE number: ${token}`);
	const suffix = match[2].toLowerCase();
	return Number.parseFloat(match[1]) * (SPICE_SUFFIXES[suffix] ?? 1);
}

function evaluate(expression: string, scope: Map<string, number>): number {
	const source = expression.replace(/\s+/g, '');
	let index = 0;
	const peek = (): string => source[index];

	const primary = (): number => {
		if (peek() === '(') {
			index++;
			const value = addSub();
			if (source[index] !== ')') throw new Error(`expected ) in ${expression}`);
			index++;
			return value;
		}
		if (peek() === '+') {
			index++;
			return primary();
		}
		if (peek() === '-') {
			index++;
			return -primary();
		}
		const start = index;
		while (index < source.length && /[A-Za-z0-9_.]/.test(source[index])) index++;
		const token = source.slice(start, index);
		if (token === '') throw new Error(`bad expression: ${expression}`);
		if (/^[A-Za-z_]/.test(token)) {
			const value = scope.get(token);
			if (value === undefined) throw new Error(`unknown parameter ${token}`);
			return value;
		}
		return parseSpiceNumber(token);
	};
	const mulDiv = (): number => {
		let value = primary();
		while (peek() === '*' || peek() === '/') {
			const operator = source[index++];
			const right = primary();
			value = operator === '*' ? value * right : value / right;
		}
		return value;
	};
	const addSub = (): number => {
		let value = mulDiv();
		while (peek() === '+' || peek() === '-') {
			const operator = source[index++];
			const right = mulDiv();
			value = operator === '+' ? value + right : value - right;
		}
		return value;
	};
	const result = addSub();
	if (index !== source.length) throw new Error(`trailing expression: ${expression}`);
	return result;
}

/** U1 spike-level `.param`/brace resolver; the production parser is U8's. */
function resolveParameterizedDeck(source: string): string {
	const lines = source.split('\n');
	const globalParams = new Map<string, number>();
	const head: string[] = ['* resolved parameterized deck'];
	let index = 0;

	while (index < lines.length) {
		const definition = lines[index].match(/^\s*\.param\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/i);
		if (definition) {
			globalParams.set(definition[1], evaluate(definition[2], globalParams));
			index++;
			continue;
		}
		if (/^\s*\.subckt\s/i.test(lines[index])) break;
		if (!/^\s*\*/.test(lines[index])) head.push(lines[index]);
		index++;
	}

	const subcktLine = lines[index].match(/^\s*\.subckt\s+(\S+)\s+(.*?)\s*(?:PARAMS:\s*(.*))?$/i);
	if (!subcktLine) throw new Error('fixture has no .subckt');
	const pins = subcktLine[2].trim().split(/\s+/);
	const defaults = new Map<string, number>();
	for (const entry of (subcktLine[3] ?? '').split(/\s+/).filter(Boolean)) {
		const parameter = entry.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
		if (!parameter) throw new Error(`bad subckt parameter: ${entry}`);
		defaults.set(parameter[1], evaluate(parameter[2], globalParams));
	}
	index++;

	const body: string[] = [];
	while (index < lines.length && !/^\s*\.ends/i.test(lines[index])) {
		if (!/^\s*\*/.test(lines[index])) body.push(lines[index]);
		index++;
	}
	index++;

	const format = (value: number): string => Number(value.toPrecision(12)).toString();
	const expanded: string[] = [];
	const tail: string[] = [];
	for (; index < lines.length; index++) {
		const instance = lines[index].match(/^\s*(X\S*)\s+(.*)$/i);
		if (!instance) {
			if (!/^\s*\*/.test(lines[index])) tail.push(lines[index]);
			continue;
		}
		const scope = new Map([...globalParams, ...defaults]);
		const nodes: string[] = [];
		for (const token of instance[2].split(/\s+/)) {
			const override = token.match(/^([A-Za-z_]\w*)\s*=\s*\{(.+)\}$/);
			if (override) scope.set(override[1], evaluate(override[2], scope));
			else nodes.push(token);
		}
		nodes.pop(); // the last non-override token is the subckt name
		if (nodes.length !== pins.length) throw new Error('pin count does not match subckt definition');
		const pinMap = new Map(pins.map((pin, position) => [pin.toUpperCase(), nodes[position]]));
		for (const line of body) {
			const substituted = line.replace(
				/\{([^}]+)\}/g,
				(_, expression: string) => format(evaluate(expression, scope))
			);
			expanded.push(
				substituted
					.split(/\s+/)
					.map((token) => pinMap.get(token.toUpperCase()) ?? token)
					.join(' ')
			);
		}
	}
	return [...head, ...expanded, ...tail].join('\n');
}

describe('U1 ngspice-WASM spike: numeric accuracy (KTD5)', () => {
	it('divider .op returns 6.0 V within 1%', async () => {
		const { plot, diagnostics } = await runDeck(fixture('divider.cir'));
		const midpoint = realValues(findVariable(plot, 'v(2)'))[0];
		expect(diagnostics).toEqual([]);
		expect(withinRelative(midpoint, 6.0, ANALOG_TOLERANCES.opLinear)).toBe(true);
	});

	it('RC .ac corner is 1.59 kHz within 2% with a -20 dB/decade slope', async () => {
		const { plot } = await runDeck(fixture('rc-lowpass-ac.cir'));
		const frequencies = realValues(findVariable(plot, 'frequency'));
		const response = magnitudes(findVariable(plot, 'v(2)'));
		const corner = lowPassCorner(frequencies, response);
		expect(relativeError(corner, RC_CORNER_HZ)).toBeLessThanOrEqual(ANALOG_TOLERANCES.acCorner);

		const decibels = (frequency: number): number =>
			toDecibels(sampleAt(frequencies, response, frequency));
		const slopePerDecade = decibels(corner * 10) - decibels(corner * 100);
		expect(withinAbsolute(slopePerDecade, 20, ANALOG_TOLERANCES.acMagnitudeDb)).toBe(true);
	});

	it('RC .tran time constant and samples are within 2% of the analytic response', async () => {
		const { plot } = await runDeck(fixture('rc-step-tran.cir'));
		const time = realValues(findVariable(plot, 'time'));
		const response = realValues(findVariable(plot, 'v(2)'));
		const atTau = sampleAt(time, response, RC_TAU_S);
		const fittedTau = -RC_TAU_S / Math.log(1 - atTau);
		expect(relativeError(fittedTau, RC_TAU_S)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.tranTimeConstant
		);
		for (const t of [50e-6, 100e-6, 200e-6, 500e-6]) {
			const analytic = 1 - Math.exp(-t / RC_TAU_S);
			expect(withinRelative(sampleAt(time, response, t), analytic, ANALOG_TOLERANCES.tranSample)).toBe(
				true
			);
		}
	});

	it('diode clamp forward drop is datasheet-typical (0.6-0.8 V)', async () => {
		const { plot } = await runDeck(fixture('diode-clamp.cir'));
		const forwardDrop = realValues(findVariable(plot, 'v(2)'))[0];
		const current = -realValues(findVariable(plot, 'i(v1)'))[0];
		expect(current).toBeGreaterThan(1e-3);
		expect(withinRange(forwardDrop, 0.6, 0.8)).toBe(true);
	});

	it('BJT bias collector current and voltage match hand calculation within 2%', async () => {
		const { plot } = await runDeck(fixture('bjt-bias.cir'));
		const collectorVoltage = realValues(findVariable(plot, 'v(2)'))[0];
		const baseVoltage = realValues(findVariable(plot, 'v(3)'))[0];
		const collectorCurrent = (12 - collectorVoltage) / 2200;

		const { vth, rth } = thevenin(12, 470e3, 100e3);
		let referenceCurrent = 3.5e-3;
		for (let iteration = 0; iteration < 200; iteration++) {
			const vce = 12 - 2200 * referenceCurrent;
			const vbe = V_T * Math.log(referenceCurrent / 1e-14);
			const baseCurrent = (vth - vbe) / rth;
			referenceCurrent = 200 * baseCurrent * (1 + vce / 100);
		}
		const referenceVoltage = 12 - 2200 * referenceCurrent;

		expect(relativeError(collectorCurrent, referenceCurrent)).toBeLessThanOrEqual(0.02);
		expect(relativeError(collectorVoltage, referenceVoltage)).toBeLessThanOrEqual(0.02);
		expect(withinRange(baseVoltage, 0.6, 0.8)).toBe(true);
	});

	it('minimal op-amp subcircuit buffers 1.0 V within 1%', async () => {
		const deck = `${fixture('opamp-min.subckt')}
* unity-gain buffer around the U1-local macromodel
VCC 10 0 DC 12
VEE 11 0 DC -12
VIN 1 0 DC 1
X1 1 2 2 10 11 OPAMP_MIN
RLOAD 2 0 10k
.op
.end
`;
		const { plot } = await runDeck(deck);
		const output = realValues(findVariable(plot, 'v(2)'))[0];
		expect(withinRelative(output, 1.0, ANALOG_TOLERANCES.opLinear)).toBe(true);
	});
});

describe('U1 ngspice-WASM spike: number/parameter front end (KTD6)', () => {
	it('resolves a vendor-style parameterized .subckt and simulates the resolved values', async () => {
		const resolved = resolveParameterizedDeck(fixture('vendor-rc-filter.cir'));
		expect(resolved).not.toMatch(/\.param|\{|\}|\.subckt/i);
		expect(resolved).toContain('R1 1 2 1500');
		expect(resolved).toContain('C1 2 0 1e-7');

		const { plot, exitCode } = await runDeck(resolved);
		expect(exitCode).toBe(0);
		const frequencies = realValues(findVariable(plot, 'frequency'));
		const response = magnitudes(findVariable(plot, 'v(2)'));
		const expected = 1 / (2 * Math.PI * 1.5e3 * 100e-9);
		expect(relativeError(lowPassCorner(frequencies, response), expected)).toBeLessThanOrEqual(
			ANALOG_TOLERANCES.acCorner
		);
	});

	it('rejects an unresolved .param deck because numparam is excluded', async () => {
		const { exitCode, diagnostics, raw } = await executeDeck(fixture('vendor-rc-filter.cir'));
		expect(raw).toBeNull();
		expect(exitCode).not.toBe(0);
		expect(diagnostics.join('\n')).toMatch(/unknown subckt/i);
	});
});

describe('U1 ngspice-WASM spike: load and budget evidence', () => {
	it('records compile, instantiate, cold and warm run costs', async () => {
		const rssBefore = process.memoryUsage().rss;
		const cold = await runDeck(fixture('divider.cir'));
		const warm = await runDeck(fixture('divider.cir'));
		const measurements = {
			compileMs: Number((getCompileMs() ?? -1).toFixed(1)),
			coldInstantiateMs: Number(cold.instantiateMs.toFixed(1)),
			coldRunMs: Number(cold.totalMs.toFixed(1)),
			warmInstantiateMs: Number(warm.instantiateMs.toFixed(1)),
			warmRunMs: Number(warm.totalMs.toFixed(1)),
			rssDeltaBytes: process.memoryUsage().rss - rssBefore
		};
		console.log(`[U1 measurements] ${JSON.stringify(measurements)}`);
		expect(measurements.compileMs).toBeGreaterThanOrEqual(0);
		expect(cold.totalMs).toBeLessThan(10_000);
		expect(warm.totalMs).toBeLessThan(10_000);
	});
});
