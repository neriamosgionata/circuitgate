import { describe, expect, it } from 'vitest';

import type { CircuitDocument, Component } from '../../../model/circuit';
import { emitNetlist } from '../netlist';
import { analogKind, isModelBackedKind } from '../primitives';
import type { AnalogAnalysis } from '../../../model/circuit';
import { curatedModelsForClass, modelOptionsForKind, resolveModel } from '../models';

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

function document(components: Component[]): CircuitDocument {
	return { schemaVersion: 1, domain: 'analog', components };
}

function opAnalysis(id = 'op1'): AnalogAnalysis {
	return { id, kind: 'op', params: {} };
}

describe('discrete breadth kinds', () => {
	it('exposes a PNP transistor kind with BJT pins and a PNP default model', () => {
		const kind = analogKind('pnp');
		expect(kind).not.toBeNull();
		expect([...kind!.inputs]).toEqual(['base', 'collector']);
		expect([...kind!.outputs]).toEqual(['emitter']);
		expect(kind!.defaultParams['model']).toBe('q2n3906');
		expect(isModelBackedKind('pnp')).toBe(true);
	});

	it('exposes a bridge rectifier kind with AC inputs and DC outputs', () => {
		const kind = analogKind('bridge');
		expect(kind).not.toBeNull();
		expect([...kind!.inputs]).toEqual(['ac1', 'ac2']);
		expect([...kind!.outputs]).toEqual(['plus', 'minus']);
		expect(kind!.defaultParams['model']).toBe('d1n4148');
		expect(isModelBackedKind('bridge')).toBe(true);
	});

	it('ships the new curated cards with license-clean provenance', () => {
		for (const name of ['d1n5819', 'q2n3906', 'ld1117v33']) {
			const resolved = resolveModel(name);
			expect(resolved?.origin, name).toBe('curated');
			expect(resolved!.text.length, name).toBeGreaterThan(0);
		}
		expect(curatedModelsForClass('diode').map((model) => model.entry.name)).toContain('d1n5819');
		expect(curatedModelsForClass('pnp').map((model) => model.entry.name)).toEqual(['q2n3906']);
		expect(curatedModelsForClass('regulator').map((model) => model.entry.name)).toContain('ld1117v33');
	});

	it('offers the new models in the Inspector dropdown for their class', () => {
		expect(modelOptionsForKind('pnp').map((option) => option.name)).toContain('q2n3906');
		expect(modelOptionsForKind('diode').map((option) => option.name)).toContain('d1n5819');
		expect(modelOptionsForKind('regulator').map((option) => option.name)).toContain('ld1117v33');
	});
});

describe('discrete breadth netlist emission', () => {
	it('emits a PNP instance with BJT terminal order', () => {
		const doc = document([
			component('q1', 'pnp', { base: 'b', collector: 'c' }, { emitter: 'e' }, { model: 'q2n3906' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('Q1 c b e q2n3906');
		expect(result.deck).toContain('.model q2n3906 pnp(');
	});

	it('emits four diodes for a bridge rectifier', () => {
		const doc = document([
			component(
				'br1',
				'bridge',
				{ ac1: 'a', ac2: 'b' },
				{ plus: 'p', minus: 'm' },
				{ model: 'd1n4148' }
			),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('D1 a p d1n4148');
		expect(result.deck).toContain('D2 b p d1n4148');
		expect(result.deck).toContain('D3 m a d1n4148');
		expect(result.deck).toContain('D4 m b d1n4148');
	});

	it('emits a Schottky diode and a 3.3V regulator with their cards', () => {
		const doc = document([
			component('v1', 'vsource', {}, { p2: 'in' }, { waveform: 'dc', voltage: 9 }),
			component('d1', 'diode', { p1: 'in' }, { p2: 'mid' }, { model: 'd1n5819' }),
			component('u1', 'regulator', { vin: 'mid' }, { vout: 'out', gnd: '0' }, { model: 'ld1117v33' }),
			component('g1', 'ground', { p1: '0' }, {})
		]);
		const result = emitNetlist(doc, opAnalysis());
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('.model d1n5819 d(');
		expect(result.deck).toContain('D1 in mid d1n5819');
		expect(result.deck).toContain('.subckt ld1117v33 vin vout gnd');
	});
});
