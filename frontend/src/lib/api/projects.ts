import { detectDefinitionCycles, type SubcircuitDefinition, type SubcircuitDefinitions } from '../engine/hierarchy';
import type { CircuitDocument, Component } from '../model/circuit';
import { validateDocumentShape } from '../model/schema';
import type { ComponentLayout, LayoutMap, Point } from '../render/geometry';
import { apiFetch } from './client';

export const PROJECT_FORMAT = 'circuitgate-project';
export const PROJECT_SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_DEPTH = 64;
export const MAX_COMPONENTS = 50000;

export interface ProjectDocument {
	circuit: CircuitDocument;
	definitions: SubcircuitDefinitions;
	layouts: Readonly<Record<string, LayoutMap>>;
}

export interface ProjectSummary {
	id: string;
	name: string;
	version: number;
	ownerId: string;
	owned: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
	schemaVersion: number;
	document: unknown;
}

export interface ExportEnvelope {
	format: string;
	schemaVersion: number;
	contentVersion: number;
	name: string;
	document: unknown;
}

export interface ValidationFailure {
	ok: false;
	errors: string[];
}

export type ValidationResult = { ok: true; document: ProjectDocument } | ValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exceedsDepth(value: unknown, depth: number, maxDepth: number): boolean {
	if (depth > maxDepth) return true;
	if (Array.isArray(value)) {
		return value.some((child) => exceedsDepth(child, depth + 1, maxDepth));
	}
	if (isRecord(value)) {
		return Object.values(value).some((child) => exceedsDepth(child, depth + 1, maxDepth));
	}
	return false;
}

function validateComponents(circuit: unknown, errors: string[]): CircuitDocument | null {
	if (!isRecord(circuit) || !Array.isArray(circuit.components)) {
		errors.push('circuit must be an object with a components array');
		return null;
	}
	if (circuit.components.length > MAX_COMPONENTS) {
		errors.push(`circuit exceeds ${MAX_COMPONENTS} components`);
		return null;
	}
	const document = circuit as unknown as CircuitDocument;
	for (const issue of validateDocumentShape(document)) {
		errors.push(`${issue.path}: ${issue.message}`);
	}
	if (errors.length > 0) return null;
	return document;
}

function validateDefinitions(value: unknown, errors: string[]): SubcircuitDefinitions | null {
	if (!isRecord(value)) {
		errors.push('definitions must be an object');
		return null;
	}
	const definitions: Record<string, SubcircuitDefinition> = {};
	for (const [name, candidate] of Object.entries(value)) {
		if (!isRecord(candidate) || !isRecord(candidate.inputs) || !isRecord(candidate.outputs)) {
			errors.push(`definitions.${name}: expected name, inputs, outputs, and document`);
			return null;
		}
		const inner = candidate.document;
		if (!isRecord(inner) || !Array.isArray(inner.components)) {
			errors.push(`definitions.${name}.document: expected a components array`);
			return null;
		}
		definitions[name] = candidate as unknown as SubcircuitDefinition;
	}
	try {
		detectDefinitionCycles(definitions);
	} catch (error) {
		errors.push(error instanceof Error ? error.message : 'subcircuit definitions contain a cycle');
		return null;
	}
	return definitions;
}

function validatePoint(value: unknown): Point | null {
	if (!isRecord(value) || typeof value['x'] !== 'number' || typeof value['y'] !== 'number') return null;
	if (!Number.isFinite(value['x']) || !Number.isFinite(value['y'])) return null;
	return { x: value['x'], y: value['y'] };
}

function validateLayouts(value: unknown, errors: string[]): Record<string, LayoutMap> | null {
	if (!isRecord(value)) {
		errors.push('layouts must be an object');
		return null;
	}
	const layouts: Record<string, LayoutMap> = {};
	for (const [scope, entries] of Object.entries(value)) {
		if (!isRecord(entries)) {
			errors.push(`layouts.${scope}: expected an object of component layouts`);
			return null;
		}
		const layout: Record<string, ComponentLayout> = {};
		for (const [componentId, entry] of Object.entries(entries)) {
			if (!isRecord(entry)) {
				errors.push(`layouts.${scope}.${componentId}: expected a layout entry`);
				return null;
			}
			const position = validatePoint(entry['position']);
			if (!position) {
				errors.push(`layouts.${scope}.${componentId}.position: expected finite x and y`);
				return null;
			}
			if (entry['label'] !== undefined && typeof entry['label'] !== 'string') {
				errors.push(`layouts.${scope}.${componentId}.label: expected a string`);
				return null;
			}
			layout[componentId] =
				entry['label'] === undefined ? { position } : { position, label: entry['label'] as string };
		}
		layouts[scope] = layout;
	}
	return layouts;
}

export function validateProjectDocument(value: unknown): ValidationResult {
	const errors: string[] = [];
	if (!isRecord(value)) {
		return { ok: false, errors: ['document must be an object'] };
	}
	if (exceedsDepth(value, 1, MAX_DOCUMENT_DEPTH)) {
		return { ok: false, errors: [`document exceeds the maximum depth of ${MAX_DOCUMENT_DEPTH}`] };
	}
	const circuit = validateComponents(value['circuit'], errors);
	const definitions = validateDefinitions(value['definitions'], errors);
	const layouts = validateLayouts(value['layouts'], errors);
	if (!circuit || !definitions || !layouts) {
		return { ok: false, errors };
	}
	return { ok: true, document: { circuit, definitions, layouts } };
}

function clonePoint(point: Point): Point {
	return { x: point.x, y: point.y };
}

function cloneLayoutMap(layout: LayoutMap): Record<string, ComponentLayout> {
	const copy: Record<string, ComponentLayout> = {};
	for (const [id, entry] of Object.entries(layout)) {
		copy[id] = entry.label === undefined
			? { position: clonePoint(entry.position) }
			: { position: clonePoint(entry.position), label: entry.label };
	}
	return copy;
}

export function toProjectDocument(document: ProjectDocument): ProjectDocument {
	const definitions: Record<string, SubcircuitDefinition> = {};
	for (const [name, definition] of Object.entries(document.definitions)) {
		definitions[name] = {
			name: definition.name,
			inputs: { ...definition.inputs },
			outputs: { ...definition.outputs },
			document: {
				schemaVersion: definition.document.schemaVersion,
				components: definition.document.components.map((component) => cloneComponent(component))
			}
		};
	}
	const layouts: Record<string, LayoutMap> = {};
	for (const [scope, layout] of Object.entries(document.layouts)) {
		layouts[scope] = cloneLayoutMap(layout);
	}
	return {
		circuit: {
			schemaVersion: document.circuit.schemaVersion,
			components: document.circuit.components.map((component) => cloneComponent(component))
		},
		definitions,
		layouts
	};
}

function cloneComponent(component: Component): Component {
	const copy: Component = {
		id: component.id,
		kind: component.kind,
		inputs: { ...component.inputs },
		outputs: { ...component.outputs }
	};
	if (component.params !== undefined) copy.params = structuredClone(component.params);
	if (component.initialState !== undefined) copy.initialState = structuredClone(component.initialState);
	return copy;
}

export function emptyProjectDocument(): ProjectDocument {
	return { circuit: { schemaVersion: 1, components: [] }, definitions: {}, layouts: { '': {} } };
}

export async function listProjects(): Promise<ProjectSummary[]> {
	return apiFetch<ProjectSummary[]>('/api/projects');
}

export async function getProject(id: string): Promise<ProjectDetail> {
	return apiFetch<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);
}

export async function createProject(name: string, document: ProjectDocument): Promise<ProjectDetail> {
	return apiFetch<ProjectDetail>('/api/projects', {
		method: 'POST',
		body: { name, schemaVersion: PROJECT_SCHEMA_VERSION, document: toProjectDocument(document) }
	});
}

export async function saveProject(
	id: string,
	name: string,
	version: number,
	document: ProjectDocument,
	lockEpoch: number | null = null
): Promise<ProjectDetail> {
	const body: Record<string, unknown> = {
		name,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		version,
		document: toProjectDocument(document)
	};
	if (lockEpoch !== null) {
		body['lockEpoch'] = lockEpoch;
	}
	return apiFetch<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`, {
		method: 'PUT',
		body
	});
}

export async function deleteProject(id: string): Promise<void> {
	await apiFetch<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function exportProject(id: string): Promise<ExportEnvelope> {
	return apiFetch<ExportEnvelope>(`/api/projects/${encodeURIComponent(id)}/export`);
}

export async function importProject(envelope: ExportEnvelope): Promise<ProjectDetail> {
	return apiFetch<ProjectDetail>('/api/projects/import', {
		method: 'POST',
		body: {
			format: PROJECT_FORMAT,
			name: envelope.name,
			schemaVersion: envelope.schemaVersion,
			contentVersion: envelope.contentVersion,
			document: envelope.document
		}
	});
}

export function downloadDocument(envelope: ExportEnvelope, fallbackName = 'project'): void {
	const base = (envelope.name || fallbackName).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	const filename = `${base || fallbackName}.circuitgate.json`;
	const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export function localExportEnvelope(name: string, contentVersion: number, document: ProjectDocument): ExportEnvelope {
	return {
		format: PROJECT_FORMAT,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		contentVersion,
		name,
		document: toProjectDocument(document)
	};
}
