import type { Domain } from '../model/circuit';
import { analogKinds } from './analog/primitives';
import { primitiveKinds } from './primitives';

export interface PrimitivePinout {
	readonly inputs: readonly string[];
	readonly outputs: readonly string[];
}

function registryFor(domain: Domain): Readonly<Record<string, PrimitivePinout>> {
	return domain === 'analog' ? analogKinds : primitiveKinds;
}

export function resolveKind(kind: string, domain: Domain): PrimitivePinout | null {
	return registryFor(domain)[kind] ?? null;
}

export function isKindInDomain(kind: string, domain: Domain): boolean {
	return resolveKind(kind, domain) !== null;
}

export function kindNamesForDomain(domain: Domain): string[] {
	return Object.keys(registryFor(domain));
}

export function kindExistsInOtherDomain(kind: string, domain: Domain): boolean {
	const other: Domain = domain === 'analog' ? 'logic' : 'analog';
	return isKindInDomain(kind, other);
}
