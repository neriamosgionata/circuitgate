import { ANALOG_ANALYSIS_KINDS, type CircuitDocument } from './circuit';

export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_MODEL_TEXT_LENGTH = 10_000;

export interface DocumentIssue {
	path: string;
	message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateDomain(value: unknown, issues: DocumentIssue[]): void {
	if (value === undefined) return;
	if (value !== 'logic' && value !== 'analog') {
		issues.push({ path: 'domain', message: 'expected "logic" or "analog"' });
	}
}

function validateModels(value: unknown, issues: DocumentIssue[]): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		issues.push({ path: 'models', message: 'models must be an array' });
		return;
	}
	const names = new Set<string>();
	value.forEach((entry, index) => {
		const path = `models.${index}`;
		if (!isRecord(entry)) {
			issues.push({ path, message: 'model entry must be an object' });
			return;
		}
		const name = entry['name'];
		if (typeof name !== 'string' || name.length === 0) {
			issues.push({ path, message: 'model name is required' });
		} else if (names.has(name)) {
			issues.push({ path, message: 'duplicate model name' });
		} else {
			names.add(name);
		}
		const formatVersion = entry['formatVersion'];
		if (
			typeof formatVersion !== 'number' ||
			!Number.isInteger(formatVersion) ||
			formatVersion < 1
		) {
			issues.push({ path, message: 'model formatVersion must be a positive integer' });
		}
		const source = entry['source'];
		if (typeof source !== 'string' || source.length === 0) {
			issues.push({ path, message: 'model source is required' });
		} else if (source.length > MAX_MODEL_TEXT_LENGTH) {
			issues.push({ path, message: `model source exceeds ${MAX_MODEL_TEXT_LENGTH} characters` });
		}
	});
}

function validateAnalyses(value: unknown, issues: DocumentIssue[]): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		issues.push({ path: 'analyses', message: 'analyses must be an array' });
		return;
	}
	const ids = new Set<string>();
	value.forEach((entry, index) => {
		const path = `analyses.${index}`;
		if (!isRecord(entry)) {
			issues.push({ path, message: 'analysis entry must be an object' });
			return;
		}
		const id = entry['id'];
		if (typeof id !== 'string' || id.length === 0) {
			issues.push({ path, message: 'analysis id is required' });
		} else if (ids.has(id)) {
			issues.push({ path, message: 'duplicate analysis id' });
		} else {
			ids.add(id);
		}
		const kind = entry['kind'];
		if (typeof kind !== 'string' || !(ANALOG_ANALYSIS_KINDS as readonly string[]).includes(kind)) {
			issues.push({ path, message: `analysis kind must be one of ${ANALOG_ANALYSIS_KINDS.join(', ')}` });
		}
		const params = entry['params'];
		if (params !== undefined && !isRecord(params)) {
			issues.push({ path, message: 'analysis params must be an object' });
		}
	});
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

	validateDomain(document.domain, issues);
	validateModels(document.models, issues);
	validateAnalyses(document.analyses, issues);

	return issues;
}
