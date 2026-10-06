import { describe, expect, it } from 'vitest';

import {
	MAX_DOCUMENT_DEPTH,
	toProjectDocument,
	validateProjectDocument,
	type ProjectDocument
} from '../../api/projects';
import type { CircuitDocument, Component } from '../../model/circuit';
import { MAX_MODEL_TEXT_LENGTH } from '../../model/schema';
import { CircuitEditorStore } from '../circuitStore';
import { removeComponents } from '../selection';

function analogSections() {
	return {
		domain: 'analog' as const,
		models: [
			{ name: 'd1n4148', formatVersion: 1, source: '.model d1n4148 d(is=2.52e-9 rs=0.568)' },
			{ name: 'opamp741', formatVersion: 1, source: '.subckt opamp741 in+ in- out v+ v-\n.ends opamp741' }
		],
		analyses: [
			{ id: 'op1', kind: 'op' as const, params: {} },
			{ id: 'tran1', kind: 'tran' as const, params: { step: 0.000001, stop: 0.001 } }
		]
	};
}

function dividerComponents(): Component[] {
	return [
		{ id: 'sw1', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
		{ id: 'sw2', kind: 'switch', inputs: {}, outputs: { out: 'B' } },
		{ id: 'p1', kind: 'probe', inputs: { in: 'A' }, outputs: {} },
		{ id: 'p2', kind: 'probe', inputs: { in: 'B' }, outputs: {} },
		{ id: 'p3', kind: 'probe', inputs: { in: 'A' }, outputs: {} },
		{ id: 'p4', kind: 'probe', inputs: { in: 'B' }, outputs: {} }
	];
}

function analogComponents(): Component[] {
	return [
		{ id: 'r1', kind: 'resistor', inputs: {}, outputs: { p2: 'A' }, params: { resistance: 1000 } },
		{ id: 'r2', kind: 'resistor', inputs: {}, outputs: { p2: 'B' }, params: { resistance: 2000 } },
		{ id: 'c1', kind: 'capacitor', inputs: { p1: 'A' }, outputs: {}, params: { capacitance: 1e-6 } },
		{ id: 'c2', kind: 'capacitor', inputs: { p1: 'B' }, outputs: {}, params: { capacitance: 1e-6 } }
	];
}

function unwiredStore(): CircuitEditorStore {
	return new CircuitEditorStore({
		circuit: {
			schemaVersion: 1,
			components: [
				{ id: 'r9', kind: 'resistor', inputs: {}, outputs: {} },
				{ id: 'c9', kind: 'capacitor', inputs: {}, outputs: {} }
			],
			...analogSections()
		} as CircuitDocument
	});
}

function sectionsDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		components: analogComponents(),
		...analogSections()
	} as CircuitDocument;
}

function seededStore(): CircuitEditorStore {
	return new CircuitEditorStore({
		circuit: sectionsDocument(),
		layouts: {
			'': {
				r1: { position: { x: 0, y: 0 } },
				r2: { position: { x: 0, y: 100 } },
				c1: { position: { x: 200, y: 0 } },
				c2: { position: { x: 200, y: 100 } }
			}
		}
	});
}

function keysOf(value: unknown): string[] {
	return Object.keys(value as Record<string, unknown>).sort();
}

function unknownField(value: unknown, key: string): unknown {
	return (value as Record<string, unknown>)[key];
}

describe('document section preservation', () => {
	it('exposes analog sections through store options and the editor snapshot', () => {
		const sections = analogSections();
		const store = new CircuitEditorStore({
			circuit: { schemaVersion: 1, components: [] } as CircuitDocument,
			...sections
		});
		expect(store.snapshot.domain).toBe('analog');
		expect(store.snapshot.models).toEqual(sections.models);
		expect(store.snapshot.analyses).toEqual(sections.analyses);
		expect(store.snapshot.document).toMatchObject(sections);
	});

	it('treats an absent domain as logic and adds no sections to logic documents', () => {
		const store = new CircuitEditorStore({
			circuit: { schemaVersion: 1, components: dividerComponents() } as CircuitDocument
		});
		expect(store.snapshot.domain).toBe('logic');
		expect(store.snapshot.models).toEqual([]);
		expect(store.snapshot.analyses).toEqual([]);
		expect(store.placeComponent('and', { x: 0, y: 0 }).ok).toBe(true);
		expect(keysOf(store.snapshot.document)).toEqual(['components', 'schemaVersion']);
	});

	it('placement preserves domain, models, and analyses', () => {
		const store = seededStore();
		expect(store.placeComponent('resistor', { x: 40, y: 40 }).ok).toBe(true);
		expect(store.snapshot.document).toMatchObject(analogSections());
	});

	it('pin-net assignment preserves sections', () => {
		const store = unwiredStore();
		expect(store.beginWire({ componentId: 'r9', pin: 'p2', side: 'output' }).ok).toBe(true);
		expect(store.completeWire({ componentId: 'c9', pin: 'p1', side: 'input' }).ok).toBe(true);
		expect(store.snapshot.document).toMatchObject(analogSections());
		const wired = store.snapshot.document.components.find((component) => component.id === 'r9');
		expect(wired?.outputs['p2']).toBeTypeOf('string');
	});

	it('net merge preserves sections', () => {
		const store = seededStore();
		expect(store.beginWire({ componentId: 'r1', pin: 'p2', side: 'output' }).ok).toBe(true);
		expect(store.completeWire({ componentId: 'c1', pin: 'p1', side: 'input' }).ok).toBe(true);
		expect(store.beginWire({ componentId: 'r2', pin: 'p2', side: 'output' }).ok).toBe(true);
		expect(store.completeWire({ componentId: 'c2', pin: 'p1', side: 'input' }).ok).toBe(true);
		expect(store.beginWire({ componentId: 'r1', pin: 'p2', side: 'output' }).ok).toBe(true);
		expect(store.completeWire({ componentId: 'c2', pin: 'p1', side: 'input' }).ok).toBe(true);
		expect(store.snapshot.document).toMatchObject(analogSections());
	});

	it('component replacement preserves sections', () => {
		const store = seededStore();
		expect(store.setParam('r1', 'label', 'main').ok).toBe(true);
		expect(store.setComponentKind('r2', 'capacitor').ok).toBe(true);
		expect(store.snapshot.document).toMatchObject(analogSections());
	});

	it('deletion through the selection module preserves sections', () => {
		const store = seededStore();
		store.setSelection(['r1']);
		expect(store.deleteSelection()).toBe(1);
		expect(store.snapshot.document).toMatchObject(analogSections());

		const direct = removeComponents(sectionsDocument(), new Set(['r2']));
		expect(direct).toMatchObject(analogSections());
		expect(direct.components.map((component) => component.id)).not.toContain('r2');
	});

	it('definition save preserves root sections', () => {
		const store = seededStore();
		store.setSelection(['r1', 'r2']);
		expect(store.beginPackaging().ok).toBe(true);
		expect(store.confirmPackage('stage').ok).toBe(true);
		expect(store.snapshot.definitions['stage']).toBeDefined();
		expect(store.snapshot.document).toMatchObject(analogSections());
	});

	it('unknown future sections survive load, mutate, and save', () => {
		const future = { keep: { nested: true } };
		const circuit = {
			schemaVersion: 1,
			components: dividerComponents(),
			futureSection: future
		} as unknown as CircuitDocument;
		const store = new CircuitEditorStore({ circuit });
		expect(store.placeComponent('and', { x: 0, y: 0 }).ok).toBe(true);
		expect(store.setParam('sw1', 'x', 1).ok).toBe(true);
		expect(unknownField(store.snapshot.document, 'futureSection')).toEqual(future);
		const exported = toProjectDocument({
			circuit: store.snapshot.circuit,
			definitions: store.snapshot.definitions,
			layouts: store.snapshot.layouts
		});
		expect(unknownField(exported.circuit, 'futureSection')).toEqual(future);
	});

	it('round-trips declared and unknown sections through validation, export, and JSON', () => {
		const document = {
			circuit: sectionsDocument(),
			definitions: {},
			layouts: { '': {} },
			futureTopLevel: { keep: true }
		} as unknown as ProjectDocument;
		const validation = validateProjectDocument(JSON.parse(JSON.stringify(document)));
		expect(validation.ok).toBe(true);
		if (!validation.ok) return;
		expect(validation.document.circuit).toMatchObject(analogSections());
		expect(unknownField(validation.document, 'futureTopLevel')).toEqual({ keep: true });

		const exported = toProjectDocument(validation.document);
		expect(exported.circuit).toMatchObject(analogSections());
		expect(unknownField(exported, 'futureTopLevel')).toEqual({ keep: true });
		const reparsed = JSON.parse(JSON.stringify(exported)) as ProjectDocument;
		expect(reparsed.circuit).toMatchObject(analogSections());
		expect(unknownField(reparsed, 'futureTopLevel')).toEqual({ keep: true });
	});
});

function depthOf(value: unknown): number {
	if (value === null || typeof value !== 'object') return 0;
	const children = Array.isArray(value) ? value : Object.values(value);
	let deepest = 0;
	for (const child of children) deepest = Math.max(deepest, depthOf(child));
	return 1 + deepest;
}

function documentAtDepth(depth: number): Record<string, unknown> {
	const component: Record<string, unknown> = { id: 'c1', kind: 'and', inputs: {}, outputs: {} };
	const document: Record<string, unknown> = {
		circuit: { schemaVersion: 1, components: [component] },
		definitions: {},
		layouts: { '': {} }
	};
	let cursor = component;
	while (depthOf(document) < depth) {
		const next: Record<string, unknown> = {};
		cursor['param'] = next;
		cursor = next;
	}
	return document;
}

describe('document limits', () => {
	it('aligns the client depth limit with the backend', () => {
		expect(MAX_DOCUMENT_DEPTH).toBe(50);
	});

	it('accepts documents at the depth limit and rejects deeper ones', () => {
		const atLimit = documentAtDepth(MAX_DOCUMENT_DEPTH);
		expect(depthOf(atLimit)).toBe(MAX_DOCUMENT_DEPTH);
		expect(validateProjectDocument(atLimit).ok).toBe(true);

		const beyond = documentAtDepth(MAX_DOCUMENT_DEPTH + 1);
		const result = validateProjectDocument(beyond);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(' ')).toContain(String(MAX_DOCUMENT_DEPTH));
	});

	it('rejects oversized model entries and accepts entries at the limit', () => {
		const source = 'x'.repeat(MAX_MODEL_TEXT_LENGTH);
		const atLimit = {
			circuit: { schemaVersion: 1, components: [], models: [{ name: 'm1', formatVersion: 1, source }] },
			definitions: {},
			layouts: { '': {} }
		};
		expect(validateProjectDocument(atLimit).ok).toBe(true);

		const oversized = {
			...atLimit,
			circuit: {
				...atLimit.circuit,
				models: [{ name: 'm1', formatVersion: 1, source: `${source}x` }]
			}
		};
		const result = validateProjectDocument(oversized);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(' ')).toContain('models');
	});
});
