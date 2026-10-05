import type { CircuitDocument } from './circuit';

export const SUPPORTED_SCHEMA_VERSION = 1;

export interface DocumentIssue {
	path: string;
	message: string;
}

export function validateDocumentShape(document: CircuitDocument): DocumentIssue[] {
	const issues: DocumentIssue[] = [];
	const ids = new Set<string>();

	if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
		issues.push({
			path: 'schemaVersion',
			message: `expected schema version ${SUPPORTED_SCHEMA_VERSION}, got ${document.schemaVersion}`
		});
	}

	for (const component of document.components) {
		if (!component.id) {
			issues.push({ path: 'components[]', message: 'component id is required' });
			continue;
		}
		if (ids.has(component.id)) {
			issues.push({ path: `components.${component.id}`, message: 'duplicate component id' });
		}
		ids.add(component.id);
		if (!component.kind) {
			issues.push({ path: `components.${component.id}`, message: 'component kind is required' });
		}
	}

	return issues;
}
