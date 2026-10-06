import { describe, expect, it } from 'vitest';

import type { AnalogAnalysis, AnalogModel, CircuitDocument, Component } from '../../../model/circuit';
import { emitNetlist, floatingNodes, validateAnalysis, AnalysisCaps, KTD5Defaults } from '../netlist';

function component(
	id: string,
	kind: string,
	inputs: Record<string, string>,
	outputs: Record<string, string>,
	params?: Record<string, unknown>
): Component {
	return params === undefined
		? { id, kind, inputs, outputs }
		: { id, kind, inputs, outputs, params };
}

function document(
	components: Component[],
	options: { models?: AnalogModel[]; analyses?: AnalogAnalysis[] } = {}
): CircuitDocument {
	const doc: CircuitDocument = { schemaVersion: 1, domain: 'analog', components };
	if (options.models) doc.models = options.models;
	if (options.analyses) doc.analyses = options.analyses;
	return doc;
}

function lines(deck: string): string[] {
	return deck
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => line.trimEnd());
}

function opAnalysis(id = 'op1'): AnalogAnalysis {
	return { id, kind: 'op', params: {} };
}

function tranAnalysis(params: Record<string, unknown> = {}): AnalogAnalysis {
	return { id: 'tran1', kind: 'tran', params: { ...KTD5Defaults.tran, ...params } };
}

function acAnalysis(params: Record<string, unknown> = {}): AnalogAnalysis {
	return { id: 'ac1', kind: 'ac', params: { ...KTD5Defaults.ac, ...params } };
}

describe('netlist emission: passives and sources', () => {
	it('emits a canonical grounded divider deck with the title line and analysis card', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 12 }),
			component('r1', 'resistor', { p1: 'vin' }, { p2: 'vout' }, { resistance: 10000 }),
			component('r2', 'resistor', { p1: 'vout' }, { p2: '0' }, { resistance: 10000 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(lines(result.deck)).toEqual([
			'* CircuitGate analog netlist',
			'V1 vin 0 DC 12',
			'R1 vin vout 10000',
			'R2 vout 0 10000',
			'.op',
			'.end'
		]);
		expect(result.nodeMap.nodeForNet('vin')).toBe('vin');
		expect(result.nodeMap.nodeForNet('0')).toBe('0');
	});

	it('emits resistor, capacitor, and inductor with values from params', () => {
		const doc = document([
			component('r1', 'resistor', { p1: 'a' }, { p2: 'b' }, { resistance: 4700 }),
			component('c1', 'capacitor', { p1: 'b' }, { p2: 'c' }, { capacitance: 1e-6 }),
			component('l1', 'inductor', { p1: 'c' }, { p2: '0' }, { inductance: 1e-3 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const deck = emitNetlist(doc, opAnalysis()).deck;
		expect(deck).toContain('R1 a b 4700');
		expect(deck).toContain('C1 b c 0.000001');
		expect(deck).toContain('L1 c 0 0.001');
	});

	it('emits dc, sine, pulse, and step source waveforms', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'a' }, { waveform: 'dc', voltage: 5 }),
			component('v2', 'vsource', {}, { p2: 'b' }, { waveform: 'sine', voltage: 1, frequency: 1000, offset: 0 }),
			component('v3', 'vsource', {}, { p2: 'c' }, { waveform: 'pulse', voltage: 5, frequency: 1000 }),
			component('v4', 'vsource', {}, { p2: 'd' }, { waveform: 'step', voltage: 5 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const deck = emitNetlist(doc, opAnalysis()).deck;
		expect(deck).toContain('V1 a 0 DC 5');
		expect(deck).toContain('V2 b 0 SIN(0 1 1000 0) AC 1');
		expect(deck).toContain('V3 c 0 PULSE(0 5 0 0.000001 0.000001 0.0005 0.001)');
		expect(deck).toContain('V4 d 0 PWL(0 0 0 0 0.000001 5)');
	});

	it('emits current sources with a DC value', () => {
		const doc = document([
			component('i1', 'isource', {}, { p2: 'a' }, { waveform: 'dc', current: 1e-3 }),
			component('r1', 'resistor', { p1: 'a' }, { p2: 'b' }, { resistance: 1000 }),
			component('g1', 'ground', { p1: 'b' }, {})
		]);
		expect(emitNetlist(doc, opAnalysis()).deck).toContain('I1 a 0 DC 0.001');
	});

	it('emits a closed switch as a low resistance and an open switch as a high resistance', () => {
		const closed = document([
			component('s1', 'switch', { p1: 'a' }, { p2: 'b' }, { state: 'closed' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		expect(emitNetlist(closed, opAnalysis()).deck).toContain('R1 a b 0.001');
		const open = document([
			component('s1', 'switch', { p1: 'a' }, { p2: 'b' }, { state: 'open' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		expect(emitNetlist(open, opAnalysis()).deck).toContain('R1 a b 1000000000000');
	});

	it('emits a potentiometer as two resistors split at the wiper position', () => {
		const doc = document([
			component('p1', 'potentiometer', { p1: 'a' }, { p2: 'b', wiper: 'w' }, { resistance: 10000, position: 0.25 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const deck = emitNetlist(doc, opAnalysis()).deck;
		expect(deck).toContain('R1 a w 2500');
		expect(deck).toContain('R2 w b 7500');
	});
});

describe('netlist emission: ground and node mapping', () => {
	it('maps every net touching a ground component to node 0', () => {
		const doc = document([
			component('r1', 'resistor', { p1: 'signal' }, { p2: 'earth' }, { resistance: 1000 }),
			component('g1', 'ground', { p1: 'earth' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.nodeMap.nodeForNet('earth')).toBe('0');
		expect(result.deck).toContain('R1 signal 0 1000');
	});

	it('maps an unwired pin to node 0 only when a ground component exists', () => {
		const grounded = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 5 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		expect(emitNetlist(grounded, opAnalysis()).deck).toContain('V1 vin 0 DC 5');

		const ungrounded = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 5 })
		]);
		const result = emitNetlist(ungrounded, opAnalysis());
		expect(result.deck).not.toContain('V1 vin 0 DC 5');
		expect(result.nodeMap.nodeForNet('vin')).not.toBe('0');
	});

	it('never silently maps a net named "0" to ground unless it touches a ground component', () => {
		const doc = document([
			component('r1', 'resistor', { p1: 'gnd' }, { p2: '0' }, { resistance: 1000 }),
			component('g1', 'ground', { p1: 'gnd' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.nodeMap.nodeForNet('0')).not.toBe('0');
		expect(result.deck).toMatch(/R1 0 n0 1000/);
	});
});

describe('netlist emission: model-backed devices', () => {
	it('emits a curated diode model once and a D instance', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'a' }, { waveform: 'dc', voltage: 5 }),
			component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'd1n4148' }),
			component('r1', 'resistor', { p1: 'b' }, { p2: '0' }, { resistance: 1000 }),
			component('d2', 'diode', { p1: 'a' }, { p2: 'c' }, { model: 'd1n4148' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		const deckLines = lines(result.deck);
		const modelLines = deckLines.filter((line) => line.startsWith('.model d1n4148'));
		expect(modelLines).toHaveLength(1);
		expect(deckLines).toContain('D1 a b d1n4148');
		expect(deckLines).toContain('D2 a c d1n4148');
	});

	it('emits BJT and MOSFET instances with their terminal order', () => {
		const doc = document([
			component('q1', 'bjt', { base: 'b', collector: 'c' }, { emitter: 'e' }, { model: 'q2n2222' }),
			component('m1', 'mosfet', { gate: 'g', drain: 'd' }, { source: 's' }, { model: 'm2n7000' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const deck = emitNetlist(doc, opAnalysis()).deck;
		expect(deck).toContain('Q1 c b e q2n2222');
		expect(deck).toContain('M1 d g s 0 m2n7000');
	});

	it('emits an X instance for a subcircuit model in the subckt terminal order', () => {
		const doc = document([
			component(
				'x1',
				'opamp',
				{ inp: 'n1', inn: 'n2', vcc: 'n4', vee: 'n5' },
				{ out: 'n3' },
				{ model: 'opamp741' }
			),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('.subckt opamp741 inp inn vcc vee out');
		expect(result.deck).toContain('X1 n1 n2 n4 n5 n3 opamp741');
	});

	it('emits a built-in ideal op-amp subcircuit when an ideal op-amp is placed', () => {
		const doc = document([
			component('x1', 'idealOpamp', { inp: 'n1', inn: 'n2' }, { out: 'n3' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('.subckt circuitgate_ideal_opamp inp inn out');
		expect(result.deck).toContain('X1 n1 n2 n3 circuitgate_ideal_opamp');
	});

	it('uses an imported model from the document before the curated set', () => {
		const imported: AnalogModel[] = [
			{
				name: 'mydiode',
				formatVersion: 1,
				source: '* vendor comment\n.model mydiode d(is=1e-14 n=1.2)'
			}
		];
		const doc = document(
			[
				component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'mydiode' }),
				component('g1', 'ground', { p1: '0' }, {})
			],
			{ models: imported }
		);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('.model mydiode d(is=1e-14 n=1.2)');
		expect(result.deck).not.toContain('vendor comment');
		expect(result.deck).toContain('D1 a b mydiode');
	});

	it('reports an unresolved model reference and emits no instance for it', () => {
		const doc = document([
			component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'missing' }),
			component('g1', 'ground', { p1: 'b' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems.map((problem) => problem.code)).toContain('model-unresolved');
		expect(result.deck).not.toContain('missing');
	});

	it('rejects unsupported directives inside stored model text', () => {
		const doc = document(
			[
				component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'evil' }),
				component('g1', 'ground', { p1: 'b' }, {})
			],
			{
				models: [
					{ name: 'evil', formatVersion: 1, source: '.include "/tmp/evil.lib"' }
				]
			}
		);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems.map((problem) => problem.code)).toContain('model-unsupported');
		expect(result.deck).not.toContain('.include');
	});
});

describe('netlist emission: canonical, injection-safe output', () => {
	it('sanitizes hostile net and component identifiers instead of splicing them', () => {
		const doc = document([
			component(
				'r1',
				'resistor',
				{ p1: 'a\n.control\nrun\n.endc' },
				{ p2: 'b; rm -rf' },
				{ resistance: 1000 }
			),
			component('g1', 'ground', { p1: 'b; rm -rf' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.deck).not.toContain('.control');
		expect(result.deck).not.toContain('rm -rf');
		for (const line of lines(result.deck)) {
			expect(line).not.toContain('\n');
		}
	});

	it('is deterministic for the same document', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 12 }),
			component('r1', 'resistor', { p1: 'vin' }, { p2: '0' }, { resistance: 1000 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		expect(emitNetlist(doc, tranAnalysis()).deck).toBe(emitNetlist(doc, tranAnalysis()).deck);
	});

	it('emits a transient card with the maximum step before the duration', () => {
		const doc = document([component('g1', 'ground', { p1: '0' }, {})]);
		const deck = emitNetlist(doc, tranAnalysis()).deck;
		expect(deck).toContain('.tran 0.000001 0.001');
	});

	it('marks the transient card for initial conditions when requested', () => {
		const doc = document([component('g1', 'ground', { p1: '0' }, {})]);
		const deck = emitNetlist(doc, tranAnalysis(), { useInitialConditions: true }).deck;
		expect(deck).toContain('.tran 0.000001 0.001 uic');
	});

	it('emits an AC decade sweep card', () => {
		const doc = document([component('g1', 'ground', { p1: '0' }, {})]);
		expect(emitNetlist(doc, acAnalysis()).deck).toContain('.ac dec 20 10 1000000');
	});
});

describe('DC-path connectivity check', () => {
	it('flags a capacitor-isolated node with no DC path to ground', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 5 }),
			component('c1', 'capacitor', { p1: 'vin' }, { p2: 'iso' }, { capacitance: 1e-6 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = floatingNodes(doc);
		expect(result.hasGround).toBe(true);
		expect(result.floating).toEqual(['iso']);
	});

	it('does not flag a node with a DC path through a resistor or a closed switch', () => {
		const doc = document([
			component('r1', 'resistor', { p1: 'a' }, { p2: 'b' }, { resistance: 1000 }),
			component('s1', 'switch', { p1: 'b' }, { p2: 'c' }, { state: 'closed' }),
			component('g1', 'ground', { p1: 'c' }, {})
		]);
		expect(floatingNodes(doc).floating).toEqual([]);
	});

	it('flags every net when no ground component exists', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 5 }),
			component('r1', 'resistor', { p1: 'vin' }, { p2: 'vout' }, { resistance: 1000 })
		]);
		const result = floatingNodes(doc);
		expect(result.hasGround).toBe(false);
		expect(result.floating).toEqual(['vin', 'vout']);
	});

	it('treats an open switch as breaking the DC path', () => {
		const doc = document([
			component('s1', 'switch', { p1: 'a' }, { p2: 'b' }, { state: 'open' }),
			component('r1', 'resistor', { p1: 'b' }, { p2: 'gnd' }, { resistance: 1000 }),
			component('g1', 'ground', { p1: 'gnd' }, {})
		]);
		expect(floatingNodes(doc).floating).toEqual(['a']);
	});

	it('keeps a MOSFET gate separate from the drain-source DC path', () => {
		const doc = document([
			component('m1', 'mosfet', { gate: 'gate' }, { source: 'gnd' }, { model: 'm2n7000' }),
			component('g1', 'ground', { p1: 'gnd' }, {})
		]);
		expect(floatingNodes(doc).floating).toEqual(['gate']);
	});
});

describe('analysis parameter caps', () => {
	it('accepts KTD5 default transient and AC parameters', () => {
		expect(validateAnalysis(tranAnalysis())).toEqual([]);
		expect(validateAnalysis(acAnalysis())).toEqual([]);
	});

	it('rejects a transient whose duration-to-step ratio exceeds the cap', () => {
		const analysis = tranAnalysis({
			duration: 10,
			maxStep: AnalysisCaps.maxDurationStepRatio === 1_000_000 ? 1e-6 : 1e-9
		});
		const problems = validateAnalysis(analysis);
		expect(problems.map((problem) => problem.code)).toContain('parameter-cap');
		expect(problems[0].message).toContain('internal steps');
	});

	it('rejects a transient with a non-positive duration or step', () => {
		expect(validateAnalysis(tranAnalysis({ duration: 0 })).map((p) => p.code)).toContain('parameter-invalid');
		expect(validateAnalysis(tranAnalysis({ maxStep: -1 })).map((p) => p.code)).toContain('parameter-invalid');
	});

	it('rejects an AC sweep with more points than the cap and non-positive frequencies', () => {
		const tooMany = validateAnalysis(
			acAnalysis({ startHz: 1, stopHz: 1e9, pointsPerDecade: 200000 })
		);
		expect(tooMany.map((problem) => problem.code)).toContain('parameter-cap');
		expect(
			validateAnalysis(acAnalysis({ startHz: 0 })).map((problem) => problem.code)
		).toContain('parameter-invalid');
	});

	it('requires a measurement name, type, and signal when validating a measurement entry', () => {
		const analysis: AnalogAnalysis = { id: 'm1', kind: 'meas', params: { name: '', type: 'rms', signal: '' } };
		const problems = validateAnalysis(analysis);
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.every((problem) => problem.analysisId === 'm1')).toBe(true);
	});

	it('sees DC connectivity through subcircuit instances instead of flagging their outputs', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'rail' }, { waveform: 'dc', voltage: 12 }),
			component('r1', 'resistor', { p1: 'rail' }, { p2: 'sense' }, { resistance: 10000 }),
			component('r2', 'resistor', { p1: 'sense' }, { p2: '0' }, { resistance: 10000 }),
			component('vcc', 'vsource', {}, { p2: 'vcc' }, { waveform: 'dc', voltage: 15 }),
			component('vee', 'vsource', {}, { p2: 'vee' }, { waveform: 'dc', voltage: -15 }),
			component(
				'x1',
				'opamp',
				{ inp: 'sense', inn: 'outa', vcc: 'vcc', vee: 'vee' },
				{ out: 'outa' },
				{ model: 'opamp741' }
			),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		expect(floatingNodes(doc)).toEqual({ hasGround: true, floating: [] });
	});

	it('still flags a capacitor-isolated node with no DC path', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'vin' }, { waveform: 'dc', voltage: 5 }),
			component('c1', 'capacitor', { p1: 'vin' }, { p2: 'island' }, { capacitance: 1e-6 }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		expect(floatingNodes(doc).floating).toContain('island');
	});
});
