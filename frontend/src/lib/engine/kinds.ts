import { CompileError, type ComponentKind } from './compile';
import { primitiveKinds } from './primitives';
import { analogKinds } from './analog/primitives';
import {
	magnitudeComparatorKind,
	magnitudeComparatorPins,
	rippleCarryAdderKind,
	rippleCarryAdderPins
} from './primitives/adders';
import { registerKind, registerPins } from './primitives/flipflops';
import { counterKind, counterPins, shiftRegisterKind, shiftRegisterPins } from './primitives/sequential';
import {
	ROM_DEFAULT_CONTENTS,
	ramKind,
	ramPins,
	registerFileKind,
	registerFilePins,
	requireMemoryAddressBits,
	romKind,
	romPins
} from './primitives/memory';
import {
	DEFAULT_ADDRESS_BITS,
	DEFAULT_WORD_BITS,
	DEFAULT_WIDTH,
	requireWordWidth,
	type Pinout
} from './primitives/pins';
import type { Domain } from '../model/circuit';

export type ComponentParams = Record<string, unknown>;

export type ParameterShape = 'width' | 'memory' | 'rom';

interface FamilySpec {
	readonly shape: ParameterShape;
	readonly defaults: () => ComponentParams;
	readonly pinout: (params?: ComponentParams) => Pinout;
	readonly build: (params?: ComponentParams) => ComponentKind;
}

function readIntegerParam(
	params: ComponentParams | undefined,
	key: string,
	fallback: number
): number {
	const raw = params?.[key];
	if (raw === undefined) return fallback;
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		throw new CompileError(`${key} must be an integer, got ${String(raw)}`, 'invalid-primitive-parameter');
	}
	return raw;
}

function readWidth(params: ComponentParams | undefined): number {
	const width = readIntegerParam(params, 'width', DEFAULT_WIDTH);
	requireWordWidth(width, 'width');
	return width;
}

function readAddressBits(params: ComponentParams | undefined): number {
	const addressBits = readIntegerParam(params, 'addressBits', DEFAULT_ADDRESS_BITS);
	requireMemoryAddressBits(addressBits, 'addressBits');
	return addressBits;
}

function readWordBits(params: ComponentParams | undefined): number {
	const wordBits = readIntegerParam(params, 'wordBits', DEFAULT_WORD_BITS);
	requireWordWidth(wordBits, 'wordBits');
	return wordBits;
}

function readRomContents(params: ComponentParams | undefined): readonly number[] {
	const raw = params?.['contents'];
	if (raw === undefined) return ROM_DEFAULT_CONTENTS;
	if (!Array.isArray(raw)) {
		throw new CompileError('ROM contents must be an array of numbers', 'invalid-rom-contents');
	}
	return raw as readonly number[];
}

function readRegisters(params: ComponentParams | undefined): number | undefined {
	const raw = params?.['registers'];
	if (raw === undefined) return undefined;
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		throw new CompileError(
			`register file registers must be an integer, got ${String(raw)}`,
			'invalid-register-file-size'
		);
	}
	return raw;
}

// One descriptor per parameterized family: defaults, pinout, and factory live
// together so adding a family cannot leave a stale list or a duplicate pin map
// behind. Factories and pinout helpers share the same pin definitions.
const FAMILIES: Readonly<Record<string, FamilySpec>> = Object.freeze({
	rippleCarryAdder: {
		shape: 'width',
		defaults: () => ({ width: DEFAULT_WIDTH }),
		pinout: (params) => rippleCarryAdderPins(readWidth(params)),
		build: (params) => rippleCarryAdderKind(readWidth(params))
	},
	magnitudeComparator: {
		shape: 'width',
		defaults: () => ({ width: DEFAULT_WIDTH }),
		pinout: (params) => magnitudeComparatorPins(readWidth(params)),
		build: (params) => magnitudeComparatorKind(readWidth(params))
	},
	register: {
		shape: 'width',
		defaults: () => ({ width: DEFAULT_WIDTH }),
		pinout: (params) => registerPins(readWidth(params)),
		build: (params) => registerKind(readWidth(params))
	},
	counter: {
		shape: 'width',
		defaults: () => ({ width: DEFAULT_WIDTH }),
		pinout: (params) => counterPins(readWidth(params)),
		build: (params) => counterKind(readWidth(params))
	},
	shiftRegister: {
		shape: 'width',
		defaults: () => ({ width: DEFAULT_WIDTH }),
		pinout: (params) => shiftRegisterPins(readWidth(params)),
		build: (params) => shiftRegisterKind(readWidth(params))
	},
	registerFile: {
		shape: 'memory',
		defaults: () => ({ addressBits: DEFAULT_ADDRESS_BITS, wordBits: DEFAULT_WORD_BITS }),
		pinout: (params) =>
			registerFilePins(readAddressBits(params), readWordBits(params), readRegisters(params)),
		build: (params) =>
			registerFileKind({
				addressBits: readAddressBits(params),
				wordBits: readWordBits(params),
				registers: readRegisters(params)
			})
	},
	ram: {
		shape: 'memory',
		defaults: () => ({ addressBits: DEFAULT_ADDRESS_BITS, wordBits: DEFAULT_WORD_BITS }),
		pinout: (params) => ramPins(readAddressBits(params), readWordBits(params)),
		build: (params) =>
			ramKind({ addressBits: readAddressBits(params), wordBits: readWordBits(params) })
	},
	rom: {
		shape: 'rom',
		defaults: () => ({ contents: [...ROM_DEFAULT_CONTENTS], wordBits: DEFAULT_WORD_BITS }),
		pinout: (params) => romPins(readRomContents(params), readWordBits(params)),
		build: (params) =>
			romKind({ contents: readRomContents(params), wordBits: readWordBits(params) })
	}
});

export const PARAMETERIZED_FAMILY_KINDS: readonly string[] = Object.freeze(Object.keys(FAMILIES));

const PARAMETERIZED_FAMILY_SET: ReadonlySet<string> = new Set(PARAMETERIZED_FAMILY_KINDS);

export function isParameterizedFamily(kind: string): boolean {
	return PARAMETERIZED_FAMILY_SET.has(kind);
}

export function parameterShapeFor(kind: string): ParameterShape | null {
	return FAMILIES[kind]?.shape ?? null;
}

export function defaultParamsForKind(kind: string): ComponentParams | null {
	const family = FAMILIES[kind];
	return family ? family.defaults() : null;
}

/**
 * Pin lists for a parameterized family without building the full kind: same
 * names the factories produce, validated with the same codes, but no evaluate
 * closure and no ROM word expansion. Scene and store pin lookups run per
 * rebuild; compile and simulation keep using the full factories.
 */
export function pinoutForParameterizedKind(
	kind: string,
	params?: ComponentParams
): Pinout | null {
	const family = FAMILIES[kind];
	return family ? family.pinout(params) : null;
}

/** Map a parameterized family to its factory from parameters; null otherwise. */
function resolveParameterizedKind(kind: string, params?: ComponentParams): ComponentKind | null {
	const family = FAMILIES[kind];
	return family ? family.build(params) : null;
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

function registryFor(domain: Domain): Readonly<Record<string, Pinout>> {
	return domain === 'analog' ? analogKinds : primitiveKinds;
}

export function resolveKind(
	kind: string,
	domain: Domain,
	params?: ComponentParams
): Pinout | null {
	if (domain === 'logic' && isParameterizedFamily(kind)) {
		const pinout = pinoutForParameterizedKind(kind, params);
		if (!pinout) return null;
		return { inputs: [...pinout.inputs], outputs: [...pinout.outputs] };
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
	const other: Domain = domain === 'logic' ? 'analog' : 'logic';
	return isKindInDomain(kind, other);
}
