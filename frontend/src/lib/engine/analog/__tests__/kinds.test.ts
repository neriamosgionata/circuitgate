import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { CircuitDocument } from '../../../model/circuit';
import { CircuitEditorStore } from '../../../state/circuitStore';
import {
	kindExistsInOtherDomain,
	kindNamesForDomain,
	resolveKind
} from '../../kinds';
import { analogKind, analogKinds, defaultParamsForKind, isModelBackedKind } from '../primitives';
import { formatSI, parseSI } from '../si';
import {
	CURATED_MODEL_ASSETS,
	CURATED_MODEL_MANIFEST,
	CURATED_MODELS,
	curatedModelsForClass,
	modelOptionsForKind,
	modelReferenceIssue,
	resolveModel,
	validateCuratedManifest
} from '../models';

const ALL_KINDS = [
	'vsource',
	'isource',
	'resistor',
	'capacitor',
	'inductor',
	'switch',
	'potentiometer',
	'diode',
	'led',
	'zener',
	'bjt',
	'pnp',
	'bridge',
	'mosfet',
	'idealOpamp',
	'opamp',
	'comparator',
	'timer555',
	'regulator',
	'ground'
];

function digest(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function logicStore(): CircuitEditorStore {
	return new CircuitEditorStore({
		circuit: {
			schemaVersion: 1,
			components: [{ id: 'sw1', kind: 'switch', inputs: {}, outputs: {} }]
		} as CircuitDocument
	});
}

function analogStore(): CircuitEditorStore {
	return new CircuitEditorStore({
		circuit: {
			schemaVersion: 1,
			domain: 'analog',
			components: [{ id: 'r1', kind: 'resistor', inputs: {}, outputs: {} }]
		} as CircuitDocument
	});
}

describe('analog kind registry', () => {
	it('exposes every promised device kind with a default parameter set', () => {
		for (const name of ALL_KINDS) {
			const kind = analogKind(name);
			expect(kind, name).not.toBeNull();
			expect(kind?.domain).toBe('analog');
			expect(defaultParamsForKind(name), name).not.toBeNull();
		}
		expect(new Set(kindNamesForDomain('analog'))).toEqual(new Set(ALL_KINDS));
	});

	it('keeps two-terminal devices directional and ground input-only', () => {
		for (const name of ['resistor', 'capacitor', 'inductor', 'diode', 'led', 'zener']) {
			const kind = analogKinds[name];
			expect(kind.inputs, name).toEqual(['p1']);
			expect(kind.outputs, name).toEqual(['p2']);
		}
		expect(analogKinds['ground'].inputs).toEqual(['p1']);
		expect(analogKinds['ground'].outputs).toEqual([]);
	});

	it('marks model-backed kinds and leaves the ideal op-amp model-free', () => {
		for (const name of ['diode', 'led', 'zener', 'bjt', 'pnp', 'mosfet', 'bridge', 'opamp', 'comparator', 'timer555', 'regulator']) {
			expect(isModelBackedKind(name), name).toBe(true);
		}
		expect(isModelBackedKind('idealOpamp')).toBe(false);
		expect(isModelBackedKind('resistor')).toBe(false);
	});
});

describe('domain kind resolution', () => {
	it('resolves kinds only in their own domain', () => {
		expect(resolveKind('resistor', 'analog')?.inputs).toEqual(['p1']);
		expect(resolveKind('resistor', 'logic')).toBeNull();
		expect(resolveKind('and', 'logic')?.inputs).toEqual(['a', 'b']);
		expect(resolveKind('and', 'analog')).toBeNull();
	});

	it('enumerates domain names and detects cross-domain kinds', () => {
		expect(kindNamesForDomain('analog')).toEqual(ALL_KINDS);
		expect(kindNamesForDomain('logic')).toContain('and');
		expect(kindNamesForDomain('logic')).not.toContain('resistor');
		expect(kindExistsInOtherDomain('resistor', 'logic')).toBe(true);
		expect(kindExistsInOtherDomain('and', 'analog')).toBe(true);
		expect(kindExistsInOtherDomain('resistor', 'analog')).toBe(false);
		expect(kindExistsInOtherDomain('doesNotExist', 'logic')).toBe(false);
	});

	it('refuses cross-domain placement and conversion in the store', () => {
		expect(analogStore().placeComponent('and', { x: 0, y: 0 })).toMatchObject({
			ok: false,
			error: 'unknown-kind'
		});
		expect(analogStore().placeComponent('capacitor', { x: 0, y: 0 }).ok).toBe(true);
		expect(logicStore().placeComponent('resistor', { x: 0, y: 0 })).toMatchObject({
			ok: false,
			error: 'unknown-kind'
		});

		const converted = analogStore().setComponentKind('r1', 'and');
		expect(converted).toMatchObject({ ok: false, error: 'domain-mismatch' });
		const unchanged = analogStore().snapshot.circuit.components[0];
		expect(unchanged.kind).toBe('resistor');

		expect(logicStore().setComponentKind('sw1', 'resistor')).toMatchObject({
			ok: false,
			error: 'domain-mismatch'
		});
		expect(analogStore().setComponentKind('r1', 'capacitor').ok).toBe(true);
	});
});

describe('SI suffix parsing', () => {
	it('parses unambiguous engineering suffixes', () => {
		const cases: readonly (readonly [string, number])[] = [
			['10k', 10000],
			['1meg', 1e6],
			['1m', 1e-3],
			['2.2u', 2.2e-6],
			['3n', 3e-9],
			['4.7k', 4700],
			['1e3', 1000],
			['250', 250]
		];
		for (const [text, value] of cases) {
			const parsed = parseSI(text);
			expect(parsed.ok, text).toBe(true);
			if (parsed.ok) expect(parsed.value, text).toBeCloseTo(value, 15);
		}
	});

	it('rejects ambiguous or invalid values instead of coercing them', () => {
		expect(parseSI('1M')).toMatchObject({ ok: false });
		expect(parseSI('10x')).toMatchObject({ ok: false });
		expect(parseSI('')).toMatchObject({ ok: false });
		expect(parseSI('abc')).toMatchObject({ ok: false });
		expect(parseSI('1e')).toMatchObject({ ok: false });
	});

	it('formats values back into readable SI text', () => {
		expect(formatSI(1000)).toBe('1k');
		expect(formatSI(1e6)).toBe('1meg');
		expect(formatSI(1e-3)).toBe('1m');
		expect(formatSI(0)).toBe('0');
	});
});

describe('curated model library', () => {
	it('ships a valid manifest: hashes match, redistribution permitted, no duplicates', () => {
		const issues = validateCuratedManifest(
			CURATED_MODEL_MANIFEST.entries,
			CURATED_MODEL_ASSETS,
			digest
		);
		expect(issues).toEqual([]);
		expect(CURATED_MODELS).toHaveLength(CURATED_MODEL_MANIFEST.entries.length);
	});

	it('covers every promised model class with bundle-safe assets', () => {
		for (const modelClass of ['opamp', 'comparator', 'timer', 'regulator'] as const) {
			const models = curatedModelsForClass(modelClass);
			expect(models.length, modelClass).toBeGreaterThan(0);
			for (const model of models) {
				expect(model.text.length).toBeGreaterThan(0);
				expect(model.entry.redistribution).toBe('permitted');
				expect(model.entry.source.length).toBeGreaterThan(0);
				expect(model.entry.license.length).toBeGreaterThan(0);
			}
		}
		expect(curatedModelsForClass('opamp').map((model) => model.entry.name)).toEqual(
			expect.arrayContaining(['opamp741', 'tl072'])
		);
	});

	it('resolves curated and imported model references for the inspector selector', () => {
		const imported = [{ name: 'vendorOpamp', formatVersion: 1, source: '.subckt vendorOpamp in out\n.ends' }];
		const options = modelOptionsForKind('opamp', imported);
		expect(options.map((option) => option.name)).toEqual(
			expect.arrayContaining(['opamp741', 'tl072', 'vendorOpamp'])
		);
		expect(options.find((option) => option.name === 'vendorOpamp')?.origin).toBe('imported');

		expect(resolveModel('opamp741')?.origin).toBe('curated');
		expect(resolveModel('vendorOpamp', imported)?.origin).toBe('imported');
		expect(resolveModel('missing', imported)).toBeNull();
	});

	it('reports model-reference issues without blocking model-free kinds', () => {
		expect(modelReferenceIssue('opamp', { model: 'opamp741' })).toBeNull();
		expect(modelReferenceIssue('opamp', {})).toContain('missing model reference');
		expect(modelReferenceIssue('opamp', { model: 'nope' })).toContain('unresolved model reference');
		expect(modelReferenceIssue('resistor', {})).toBeNull();
		expect(modelReferenceIssue('idealOpamp', {})).toBeNull();
	});
});
