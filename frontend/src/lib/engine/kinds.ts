import { CompileError, type ComponentKind } from './compile';
import { primitiveKinds } from './primitives';
import { analogKinds } from './analog/primitives';
import { magnitudeComparatorKind, rippleCarryAdderKind } from './primitives/adders';
import { registerKind } from './primitives/flipflops';
import { ROM_DEFAULT_CONTENTS, ramKind, registerFileKind, requireMemoryAddressBits, romKind, validatedRomAddressBits } from './primitives/memory';
import {
	DEFAULT_ADDRESS_BITS,
	DEFAULT_WORD_BITS,
	DEFAULT_WIDTH,
	MAX_ADDRESS_BITS,
	MAX_WORD_BITS,
	bitPins,
	requireWordWidth
} from './primitives/pins';
import type { Domain } from '../model/circuit';

export interface PrimitivePinout {
	readonly inputs: readonly string[];
	readonly outputs: readonly string[];
}

export type ComponentParams = Record<string, unknown>;

/**
 * Single resolver owning params-driven resolution. Every consumer
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

const PARAMETERIZED_FAMILY_SET: ReadonlySet<string> = new Set(PARAMETERIZED_FAMILY_KINDS);

function readWidth(params: ComponentParams | undefined): number {
	const raw = params?.['width'];
	if (raw === undefined) return DEFAULT_WIDTH;
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		throw new CompileError(`width must be an integer, got ${String(raw)}`, 'invalid-primitive-parameter');
	}
	return Math.min(MAX_WORD_BITS, Math.max(1, raw));
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
	if (raw === undefined) return ROM_DEFAULT_CONTENTS;
	if (!Array.isArray(raw)) {
		throw new CompileError('ROM contents must be an array of numbers', 'invalid-rom-contents');
	}
	return raw as readonly number[];
}

export function isParameterizedFamily(kind: string): boolean {
	return PARAMETERIZED_FAMILY_SET.has(kind);
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
			return { contents: [...ROM_DEFAULT_CONTENTS], wordBits: DEFAULT_WORD_BITS };
		default:
			return null;
	}
}

/**
 * Pin lists for a parameterized family without building the full kind: same
 * names the factories produce, validated with the same codes, but no
 * evaluate closure and no ROM word expansion. Scene and store pin lookups
 * run per rebuild; compile and simulation keep using the full factories.
 * An equivalence test locks these pinouts against the factories.
 */
export function pinoutForParameterizedKind(
	kind: string,
	params?: ComponentParams
): PrimitivePinout | null {
	switch (kind) {
		case 'rippleCarryAdder': {
			const width = readWidth(params);
			return {
				inputs: [...bitPins('a', width), ...bitPins('b', width), 'cin'],
				outputs: [...bitPins('s', width), 'cout']
			};
		}
		case 'magnitudeComparator': {
			const width = readWidth(params);
			return {
				inputs: [...bitPins('a', width), ...bitPins('b', width)],
				outputs: ['eq', 'gt', 'lt']
			};
		}
		case 'register': {
			const width = readWidth(params);
			return { inputs: ['clk', ...bitPins('d', width)], outputs: bitPins('q', width) };
		}
		case 'ram': {
			const addressBits = readAddressBits(params);
			const wordBits = readWordBits(params);
			requireMemoryAddressBits(addressBits, 'RAM address bits');
			requireWordWidth(wordBits);
			return {
				inputs: [...bitPins('a', addressBits), ...bitPins('d', wordBits), 'we', 'clk'],
				outputs: bitPins('q', wordBits)
			};
		}
		case 'registerFile': {
			const addressBits = readAddressBits(params);
			const wordBits = readWordBits(params);
			requireMemoryAddressBits(addressBits, 'register file address bits');
			requireWordWidth(wordBits);
			const size = 1 << addressBits;
			const registers = params?.['registers'];
			if (registers !== undefined) {
				if (typeof registers !== 'number' || !Number.isInteger(registers) || registers < 1 || registers > size) {
					throw new CompileError(
						`register file registers must be between 1 and ${size}, got ${registers}`,
						'invalid-register-file-size'
					);
				}
			}
			return {
				inputs: [
					...bitPins('ra', addressBits),
					...bitPins('rb', addressBits),
					...bitPins('wa', addressBits),
					...bitPins('wd', wordBits),
					'we',
					'clk'
				],
				outputs: [...bitPins('qa', wordBits), ...bitPins('qb', wordBits)]
			};
		}
		case 'rom': {
			const wordBits = readWordBits(params);
			const contents = readRomContents(params);
			const addressBits = validatedRomAddressBits(contents, wordBits);
			return { inputs: bitPins('a', addressBits), outputs: bitPins('d', wordBits) };
		}
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
	const other: Domain = domain === 'analog' ? 'logic' : 'analog';
	return isKindInDomain(kind, other);
}
