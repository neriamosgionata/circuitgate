import type { AnalogModel } from '../../../model/circuit';
import { analogKinds, type AnalogModelClass } from '../primitives';
import manifest from './manifest.json';
import d1n4148 from './assets/d1n4148.cir?raw';
import d1n4733 from './assets/d1n4733.cir?raw';
import d1n5819 from './assets/d1n5819.cir?raw';
import ledred from './assets/ledred.cir?raw';
import ld1117v33 from './assets/ld1117v33.cir?raw';
import lm393 from './assets/lm393.cir?raw';
import lm7805 from './assets/lm7805.cir?raw';
import m2n7000 from './assets/m2n7000.cir?raw';
import opamp741 from './assets/opamp741.cir?raw';
import q2n2222 from './assets/q2n2222.cir?raw';
import q2n3906 from './assets/q2n3906.cir?raw';
import timer555 from './assets/timer555.cir?raw';
import tl072 from './assets/tl072.cir?raw';

export interface CuratedModelEntry {
	name: string;
	modelClass: AnalogModelClass;
	file: string;
	source: string;
	license: string;
	redistribution: string;
	redistributionTerms: string;
	sha256: string;
}

export interface CuratedModelManifest {
	manifestVersion: number;
	entries: CuratedModelEntry[];
}

export interface CuratedModel {
	entry: CuratedModelEntry;
	text: string;
}

export interface ResolvedModel {
	name: string;
	origin: 'curated' | 'imported';
	text: string;
}

export const CURATED_MODEL_MANIFEST = manifest as CuratedModelManifest;

export const CURATED_MODEL_ASSETS: Readonly<Record<string, string>> = {
	'assets/d1n4148.cir': d1n4148,
	'assets/d1n4733.cir': d1n4733,
	'assets/d1n5819.cir': d1n5819,
	'assets/ledred.cir': ledred,
	'assets/ld1117v33.cir': ld1117v33,
	'assets/lm393.cir': lm393,
	'assets/lm7805.cir': lm7805,
	'assets/m2n7000.cir': m2n7000,
	'assets/opamp741.cir': opamp741,
	'assets/q2n2222.cir': q2n2222,
	'assets/q2n3906.cir': q2n3906,
	'assets/timer555.cir': timer555,
	'assets/tl072.cir': tl072
};

export const CURATED_MODELS: readonly CuratedModel[] = CURATED_MODEL_MANIFEST.entries
	.map((entry) => ({ entry, text: CURATED_MODEL_ASSETS[entry.file] ?? '' }))
	.filter((model) => model.text.length > 0);

export function curatedModelsForClass(modelClass: AnalogModelClass): readonly CuratedModel[] {
	return CURATED_MODELS.filter((model) => model.entry.modelClass === modelClass);
}

export function curatedModelByName(name: string): CuratedModel | undefined {
	return CURATED_MODELS.find((model) => model.entry.name === name);
}

export function resolveModel(
	name: string,
	imported: readonly AnalogModel[] = []
): ResolvedModel | null {
	const curated = curatedModelByName(name);
	if (curated) return { name, origin: 'curated', text: curated.text };
	const stored = imported.find((model) => model.name === name);
	if (stored) return { name, origin: 'imported', text: stored.source };
	return null;
}

export interface ModelOption {
	name: string;
	origin: 'curated' | 'imported';
}

export function modelOptionsForKind(
	kindName: string,
	imported: readonly AnalogModel[] = []
): readonly ModelOption[] {
	const modelClass = analogKinds[kindName]?.modelClass;
	if (!modelClass) return [];
	const options: ModelOption[] = curatedModelsForClass(modelClass).map((model) => ({
		name: model.entry.name,
		origin: 'curated'
	}));
	for (const model of imported) {
		if (!options.some((option) => option.name === model.name)) {
			options.push({ name: model.name, origin: 'imported' });
		}
	}
	return options;
}

export function modelReferenceIssue(
	kindName: string,
	params: Readonly<Record<string, unknown>> | undefined,
	imported: readonly AnalogModel[] = []
): string | null {
	const modelClass = analogKinds[kindName]?.modelClass;
	if (!modelClass) return null;
	const name = params?.['model'];
	if (typeof name !== 'string' || name.length === 0) {
		return `missing model reference for ${kindName}`;
	}
	return resolveModel(name, imported) ? null : `unresolved model reference: ${name}`;
}

export interface ManifestIssue {
	path: string;
	message: string;
}

export function validateCuratedManifest(
	entries: readonly CuratedModelEntry[],
	assets: Readonly<Record<string, string>>,
	digest: (text: string) => string
): ManifestIssue[] {
	const issues: ManifestIssue[] = [];
	const names = new Set<string>();
	entries.forEach((entry, index) => {
		const path = `entries.${index}`;
		for (const field of ['name', 'modelClass', 'file', 'source', 'license', 'redistributionTerms', 'sha256'] as const) {
			if (typeof entry[field] !== 'string' || entry[field].length === 0) {
				issues.push({ path, message: `${field} is required` });
			}
		}
		if (names.has(entry.name)) {
			issues.push({ path, message: `duplicate model name: ${entry.name}` });
		}
		names.add(entry.name);
		if (entry.redistribution !== 'permitted') {
			issues.push({
				path,
				message: `${entry.name} does not permit redistribution and cannot ship in the bundle`
			});
			return;
		}
		const text = assets[entry.file];
		if (text === undefined) {
			issues.push({ path, message: `${entry.file} is missing from the bundle` });
			return;
		}
		const actual = digest(text).toLowerCase();
		if (actual !== entry.sha256.toLowerCase()) {
			issues.push({
				path,
				message: `${entry.name} hash mismatch: manifest ${entry.sha256}, asset ${actual}`
			});
		}
	});
	return issues;
}
