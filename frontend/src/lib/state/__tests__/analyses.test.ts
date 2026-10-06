import { describe, expect, it } from 'vitest';

import type { CircuitDocument } from '../../model/circuit';
import { CircuitEditorStore } from '../circuitStore';

function analogDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		domain: 'analog',
		components: [
			{ id: 'r1', kind: 'resistor', inputs: { p1: 'a' }, outputs: { p2: '0' }, params: { resistance: 1000 } },
			{ id: 'g1', kind: 'ground', inputs: { p1: '0' }, outputs: {} }
		],
		models: [{ name: 'd1n4148', formatVersion: 1, source: '.model d1n4148 d(is=2.52e-9)' }],
		analyses: [{ id: 'op1', kind: 'op', params: {} }],
		futureSection: { keep: true }
	} as unknown as CircuitDocument;
}

describe('store analysis editing', () => {
	it('adds analyses with KTD5 defaults while preserving other document sections', () => {
		const store = new CircuitEditorStore({ circuit: analogDocument() });
		const added = store.addAnalysis('tran');
		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.value.kind).toBe('tran');
		expect(added.value.params).toEqual({ duration: 0.001, maxStep: 0.000001 });
		expect(added.value.id).not.toBe('op1');

		const addedAc = store.addAnalysis('ac', { pointsPerDecade: 40 });
		expect(addedAc.ok).toBe(true);
		if (!addedAc.ok) return;
		expect(addedAc.value.params).toEqual({ startHz: 10, stopHz: 1000000, pointsPerDecade: 40 });

		const document = store.snapshot.document as unknown as Record<string, unknown>;
		expect(document['models']).toEqual([
			{ name: 'd1n4148', formatVersion: 1, source: '.model d1n4148 d(is=2.52e-9)' }
		]);
		expect(document['futureSection']).toEqual({ keep: true });
		expect(store.snapshot.analyses.map((entry) => entry.kind)).toEqual(['op', 'tran', 'ac']);
	});

	it('updates existing analysis params by id and rejects unknown ids', () => {
		const store = new CircuitEditorStore({ circuit: analogDocument() });
		expect(store.updateAnalysis('op1', { marker: 1 }).ok).toBe(true);
		expect(store.snapshot.analyses[0].params).toEqual({ marker: 1 });
		expect(store.updateAnalysis('missing', {}).ok).toBe(false);
		expect(store.snapshot.analyses[0].params).toEqual({ marker: 1 });
	});

	it('removes analyses and reports whether an entry existed', () => {
		const store = new CircuitEditorStore({ circuit: analogDocument() });
		store.addAnalysis('tran');
		const tran = store.snapshot.analyses.find((entry) => entry.kind === 'tran');
		expect(tran).toBeDefined();
		expect(store.removeAnalysis(tran!.id)).toBe(true);
		expect(store.removeAnalysis(tran!.id)).toBe(false);
		expect(store.snapshot.analyses.map((entry) => entry.kind)).toEqual(['op']);
	});

	it('duplicates analyses with a fresh id and a distinct measurement name', () => {
		const store = new CircuitEditorStore({ circuit: analogDocument() });
		const measurement = store.addAnalysis('meas', { name: 'gain', type: 'rms', signal: 'v(out)' });
		expect(measurement.ok).toBe(true);
		if (!measurement.ok) return;
		const copy = store.duplicateAnalysis(measurement.value.id);
		expect(copy.ok).toBe(true);
		if (!copy.ok) return;
		expect(copy.value.id).not.toBe(measurement.value.id);
		expect(copy.value.params).toEqual({ name: 'gain copy', type: 'rms', signal: 'v(out)' });
		expect(store.duplicateAnalysis('missing').ok).toBe(false);
	});

	it('keeps logic documents free of an analyses section', () => {
		const store = new CircuitEditorStore({
			circuit: { schemaVersion: 1, components: [{ id: 'c1', kind: 'and', inputs: {}, outputs: {} }] }
		});
		store.addAnalysis('op');
		expect(store.snapshot.analyses).toHaveLength(1);
		expect(Object.keys(store.snapshot.document).sort()).toEqual(['analyses', 'components', 'schemaVersion']);
	});
});
