import { describe, expect, it } from 'vitest';

import {
	emptyProjectDocument,
	PROJECT_FORMAT,
	PROJECT_SCHEMA_VERSION,
	validateProjectDocument
} from '../projects';

const validDocument = {
	circuit: {
		schemaVersion: 1,
		components: [
			{ id: 'c1', kind: 'switch', inputs: {}, outputs: { out: 'n1' } },
			{ id: 'c2', kind: 'led', inputs: { in: 'n1' }, outputs: {} }
		]
	},
	definitions: {},
	layouts: { '': { c1: { position: { x: 10, y: 20 } }, c2: { position: { x: 210, y: 20 }, label: 'lamp' } } }
};

describe('project document schema', () => {
	it('exposes the wire format constants', () => {
		expect(PROJECT_FORMAT).toBe('circuitgate-project');
		expect(PROJECT_SCHEMA_VERSION).toBe(1);
	});

	it('accepts a well-formed document', () => {
		const result = validateProjectDocument(validDocument);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document.circuit.components).toHaveLength(2);
			expect(result.document.layouts['']).toBeDefined();
		}
	});

	it('rejects a non-object payload', () => {
		expect(validateProjectDocument(null).ok).toBe(false);
		expect(validateProjectDocument('nope').ok).toBe(false);
		expect(validateProjectDocument([]).ok).toBe(false);
	});

	it('rejects a circuit with duplicate component ids', () => {
		const result = validateProjectDocument({
			...validDocument,
			circuit: {
				schemaVersion: 1,
				components: [
					{ id: 'c1', kind: 'switch', inputs: {}, outputs: {} },
					{ id: 'c1', kind: 'led', inputs: {}, outputs: {} }
				]
			}
		});
		expect(result.ok).toBe(false);
	});

	it('rejects a definition graph with a cycle', () => {
		const result = validateProjectDocument({
			...validDocument,
			definitions: {
				a: {
					name: 'a',
					inputs: { i: 'n1' },
					outputs: {},
					document: {
						schemaVersion: 1,
						components: [
							{ id: 'x', kind: 'subcircuit', params: { definition: 'b' }, inputs: { i: 'n2' }, outputs: {} }
						]
					}
				},
				b: {
					name: 'b',
					inputs: { i: 'n1' },
					outputs: {},
					document: {
						schemaVersion: 1,
						components: [
							{ id: 'y', kind: 'subcircuit', params: { definition: 'a' }, inputs: { i: 'n2' }, outputs: {} }
						]
					}
				}
			}
		});
		expect(result.ok).toBe(false);
	});

	it('rejects malformed layout entries', () => {
		const result = validateProjectDocument({
			...validDocument,
			layouts: { '': { c1: { position: { x: 'left', y: 0 } } } }
		});
		expect(result.ok).toBe(false);
	});

	it('builds an empty document the API accepts', () => {
		const document = emptyProjectDocument();
		expect(validateProjectDocument(document).ok).toBe(true);
		expect(document.circuit.components).toEqual([]);
	});
});
