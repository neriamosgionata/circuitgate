import { describe, expect, it } from 'vitest';

import type { CircuitDocument } from '../circuit';
import { MAX_MODEL_TEXT_LENGTH, validateDocumentShape } from '../schema';

function document(overrides: Record<string, unknown> = {}): CircuitDocument {
	return { schemaVersion: 1, components: [], ...overrides } as unknown as CircuitDocument;
}

describe('document shape validation', () => {
	it('accepts a logic document with no optional sections', () => {
		expect(validateDocumentShape(document())).toEqual([]);
	});

	it('accepts a document with analog sections', () => {
		const issues = validateDocumentShape(
			document({
				domain: 'analog',
				models: [{ name: 'd1n4148', formatVersion: 1, source: '.model d1n4148 d(is=2.52e-9)' }],
				analyses: [{ id: 'op1', kind: 'op', params: { temperature: 27 } }]
			})
		);
		expect(issues).toEqual([]);
	});

	it('rejects an unknown domain', () => {
		const issues = validateDocumentShape(document({ domain: 'spice' }));
		expect(issues.some((issue) => issue.path === 'domain')).toBe(true);
	});

	it('rejects malformed model entries', () => {
		const missingFormat = validateDocumentShape(
			document({ models: [{ name: 'm1', source: '.model m1 d' }] })
		);
		expect(missingFormat.some((issue) => issue.path.startsWith('models.'))).toBe(true);

		const invalidFormat = validateDocumentShape(
			document({ models: [{ name: 'm1', formatVersion: 0, source: '.model m1 d' }] })
		);
		expect(invalidFormat.some((issue) => issue.path.startsWith('models.'))).toBe(true);

		const emptySource = validateDocumentShape(
			document({ models: [{ name: 'm1', formatVersion: 1, source: '' }] })
		);
		expect(emptySource.some((issue) => issue.path.startsWith('models.'))).toBe(true);

		const notAnArray = validateDocumentShape(document({ models: {} }));
		expect(notAnArray.some((issue) => issue.path === 'models')).toBe(true);
	});

	it('bounds model source length', () => {
		const atLimit = validateDocumentShape(
			document({
				models: [
					{ name: 'm1', formatVersion: 1, source: 'x'.repeat(MAX_MODEL_TEXT_LENGTH) }
				]
			})
		);
		expect(atLimit).toEqual([]);

		const oversized = validateDocumentShape(
			document({
				models: [
					{ name: 'm1', formatVersion: 1, source: 'x'.repeat(MAX_MODEL_TEXT_LENGTH + 1) }
				]
			})
		);
		expect(oversized.some((issue) => issue.path.startsWith('models.'))).toBe(true);
	});

	it('rejects duplicate model names', () => {
		const issues = validateDocumentShape(
			document({
				models: [
					{ name: 'm1', formatVersion: 1, source: '.model m1 d' },
					{ name: 'm1', formatVersion: 1, source: '.model m1 d' }
				]
			})
		);
		expect(issues.some((issue) => issue.path.startsWith('models.'))).toBe(true);
	});

	it('rejects malformed analysis entries', () => {
		const unknownKind = validateDocumentShape(
			document({ analyses: [{ id: 'a1', kind: 'noise', params: {} }] })
		);
		expect(unknownKind.some((issue) => issue.path.startsWith('analyses.'))).toBe(true);

		const missingId = validateDocumentShape(document({ analyses: [{ kind: 'op', params: {} }] }));
		expect(missingId.some((issue) => issue.path.startsWith('analyses.'))).toBe(true);

		const badParams = validateDocumentShape(
			document({ analyses: [{ id: 'a1', kind: 'op', params: 7 }] })
		);
		expect(badParams.some((issue) => issue.path.startsWith('analyses.'))).toBe(true);

		const duplicateIds = validateDocumentShape(
			document({
				analyses: [
					{ id: 'a1', kind: 'op', params: {} },
					{ id: 'a1', kind: 'tran', params: {} }
				]
			})
		);
		expect(duplicateIds.some((issue) => issue.path.startsWith('analyses.'))).toBe(true);
	});
});
