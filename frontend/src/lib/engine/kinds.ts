import type { CircuitDocument } from '../model/circuit';
import { CompileError, type ComponentKind, type ComponentKinds } from './compile';
import { primitiveKinds } from './primitives';
import { analogKinds } from './analog/primitives';
import { magnitudeComparatorKind, rippleCarryAdderKind } from './primitives/adders';
import { registerKind } from './primitives/flipflops';
import { ramKind, registerFileKind, romKind } from './primitives/memory';
import type { Domain } from '../model/circuit';

export interface PrimitivePinout {
	readonly inputs: readonly string[];
	readonly outputs: readonly string[];
}

export type ComponentParams = Record<string, unknown>;

/**
 * Single resolver owning params-driven resolution (KTD1). Every consumer
 * resolves each component from its own kind and parameters at use time with
 * fallback to the static registry; validation mirrors the engine
 * CompileError codes thrown by the underlying factories.
 */
export const PARAMETERIZED_FAMILY_KINDS: readonly string[] = Object.freeze([
	'rippleCarryAdder',
	'magnitudeComparator',
	'register',
	'registerFile',
	'ram',
	'rom'
]);

export const DEFAULT_WIDTH = 8;
export const DEFAULT_ADDRESS_BITS = 4;
export const DEFAULT_WORD_BITS = 8;
export const MAX_WIDTH = 32;

function readWidth(params: ComponentParams | undefined): number {
	const raw = params?.['width'];
	if (raw === undefined) return DEFAULT_WIDTH;
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		throw new CompileError(`width must be an integer, got ${String(raw)}`, 'invalid-primitive-parameter');
	}
	return Math.min(MAX_WIDTH, Math.max(1, raw));
}

function readAddressBits(params: ComponentParams | undefined): number {
	const raw = params?.['addressBits'];
	if (raw === undefined) return DEFAULT_ADDRESS_BITS;
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		throw new CompileError(`addressBits must be an integer, got ${String(raw)}`, 'invalid-primitive-parameter');
	}
	return raw;
}

function readWordBits(params: ComponentParams | undefined): number {
	const raw = params?.['wordBits'];
	if (raw === undefined) return DEFAULT_WORD_BITS;
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		throw new CompileError(`wordBits must be an integer, got ${String(raw)}`, 'invalid-primitive-parameter');
	}
	return raw;
}

function readRomContents(params: ComponentParams | undefined): readonly number[] {
	const raw = params?.['contents'];
	if (raw === undefined) return new Array(16).fill(0);
	if (!Array.isArray(raw)) {
		throw new CompileError('ROM contents must be an array of numbers', 'invalid-rom-contents');
	}
	return raw as readonly number[];
}

export function isParameterizedFamily(kind: string): boolean {
	return (PARAMETERIZED_FAMILY_KINDS as readonly string[]).includes(kind);
}

export function defaultParamsForKind(kind: string): ComponentParams | null {
	switch (kind) {
		case 'rippleCarryAdder':
		case 'magnitudeComparator':
		case 'register':
			return { width: DEFAULT_WIDTH };
		case 'registerFile':
		case 'ram':
			return { addressBits: DEFAULT_ADDRESS_BITS, wordBits: DEFAULT_WORD_BITS };
		case 'rom':
			return { contents: new Array(16).fill(0), wordBits: DEFAULT_WORD_BITS };
		default:
			return null;
	}
}

/** Map a parameterized family to its factory from parameters; null otherwise. */
export function resolveParameterizedKind(
	kind: string,
	params?: ComponentParams
): ComponentKind | null {
	switch (kind) {
		case 'rippleCarryAdder':
			return rippleCarryAdderKind(readWidth(params));
		case 'magnitudeComparator':
			return magnitudeComparatorKind(readWidth(params));
		case 'register':
			return registerKind(readWidth(params));
		case 'ram':
			return ramKind({ addressBits: readAddressBits(params), wordBits: readWordBits(params) });
		case 'registerFile': {
			const options: { addressBits: number; wordBits: number; registers?: number } = {
				addressBits: readAddressBits(params),
				wordBits: readWordBits(params)
			};
			const registers = params?.['registers'];
			if (registers !== undefined) {
				if (typeof registers !== 'number' || !Number.isInteger(registers)) {
					throw new CompileError(
						`register file registers must be an integer, got ${String(registers)}`,
						'invalid-register-file-size'
					);
				}
				options.registers = registers;
			}
			return registerFileKind(options);
		}
		case 'rom':
			// ROM depth derives from contents length and is never directly
			// edited: addressBits/depth params are ignored here.
			return romKind({ contents: readRomContents(params), wordBits: readWordBits(params) });
		default:
			return null;
	}
}

/**
 * Resolve one component from its own kind and parameters at use time,
 * falling back to the static registry. Static-kind behavior is unchanged:
 * non-parameterized kinds ignore params entirely.
 */
export function resolveComponentKind(
	kind: string,
	params?: ComponentParams
): ComponentKind | null {
	return resolveParameterizedKind(kind, params) ?? primitiveKinds[kind] ?? null;
}

function registryFor(domain: Domain): Readonly<Record<string, PrimitivePinout>> {
	return domain === 'analog' ? analogKinds : primitiveKinds;
}

export function resolveKind(
	kind: string,
	domain: Domain,
	params?: ComponentParams
): PrimitivePinout | null {
	if (domain === 'logic' && isParameterizedFamily(kind)) {
		const resolved = resolveParameterizedKind(kind, params);
		if (!resolved) return null;
		return { inputs: [...resolved.inputs], outputs: [...resolved.outputs] };
	}
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

/**
 * Build a kinds map for a document through per-component resolution: each
 * component resolves from its own kind and params. Note the engine compile()
 * still keys by kind string, so two components sharing one kind with
 * different params collide on the last entry; U3 replaces that per-kind
 * table with per-component resolution at compile time. Documents in U1 scope
 * carry at most one param configuration per kind.
 */
export function kindsForDocument(document: CircuitDocument): ComponentKinds {
	const kinds: Record<string, ComponentKind> = {};
	for (const component of document.components) {
		const resolved = resolveComponentKind(component.kind, component.params);
		if (!resolved) {
			throw new CompileError(`unknown component kind: ${component.kind}`);
		}
		kinds[component.kind] = resolved;
	}
	return kinds;
}
