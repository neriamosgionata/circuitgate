import { CompileError } from './compile';
import { nsToPs } from './time';

export type TimingField = 'delay' | 'clockToQ' | 'setup' | 'hold' | 'period' | 'duty';

export const TIMING_PARAM_KEYS: readonly TimingField[] = [
	'delay',
	'clockToQ',
	'setup',
	'hold',
	'period',
	'duty'
];

const TIMING_PARAM_SET: ReadonlySet<string> = new Set(TIMING_PARAM_KEYS);

export interface TimingProfile {
	/** Propagation delay for combinational and asynchronous parts. */
	delayPs: number;
	/** Delay from the active clock edge to a committed sequential output. */
	clockToQPs?: number;
	setupPs?: number;
	holdPs?: number;
	/** Clock period, present only on a clock source. */
	periodPs?: number;
	/** High fraction of the clock period in the range (0, 1). */
	duty?: number;
	sequential?: boolean;
	clock?: boolean;
}

export function isTimingParam(key: string): key is TimingField {
	return TIMING_PARAM_SET.has(key);
}

const COMBINATIONAL_KINDS: ReadonlySet<string> = new Set([
	'and',
	'or',
	'not',
	'nand',
	'nor',
	'xor',
	'xnor',
	'buffer',
	'triStateBuffer'
]);

const MSI_KINDS: ReadonlySet<string> = new Set([
	'mux2',
	'mux4',
	'decoder2',
	'decoder3',
	'sevenSegDecoder'
]);

const SEQUENTIAL_KINDS: ReadonlySet<string> = new Set([
	'dFlipFlop',
	'jkFlipFlop',
	'srFlipFlop',
	'register',
	'counter',
	'shiftRegister'
]);

const ZERO_DELAY_KINDS: ReadonlySet<string> = new Set([
	'switch',
	'probe',
	'led',
	'sevenSegDisplay',
	'ram',
	'rom',
	'registerFile'
]);

const COMBINATIONAL_FIELDS: readonly TimingField[] = ['delay'];
const SEQUENTIAL_FIELDS: readonly TimingField[] = ['clockToQ', 'setup', 'hold'];
const CLOCK_FIELDS: readonly TimingField[] = ['period', 'duty'];
const NO_FIELDS: readonly TimingField[] = [];

export function timingFieldsForKind(kind: string): readonly TimingField[] {
	if (kind === 'clock') return CLOCK_FIELDS;
	if (SEQUENTIAL_KINDS.has(kind)) return SEQUENTIAL_FIELDS;
	if (kind === 'srLatch') return COMBINATIONAL_FIELDS;
	if (COMBINATIONAL_KINDS.has(kind) || MSI_KINDS.has(kind)) return COMBINATIONAL_FIELDS;
	if (kind === 'halfAdder' || kind === 'fullAdder') return COMBINATIONAL_FIELDS;
	if (kind === 'rippleCarryAdder' || kind === 'magnitudeComparator') return COMBINATIONAL_FIELDS;
	if (ZERO_DELAY_KINDS.has(kind)) return NO_FIELDS;
	return NO_FIELDS;
}

function zeroProfile(): TimingProfile {
	return { delayPs: 0 };
}

function delayProfile(ns: number): TimingProfile {
	return { delayPs: nsToPs(ns) };
}

function sequentialProfile(): TimingProfile {
	return {
		delayPs: 0,
		clockToQPs: nsToPs(4),
		setupPs: nsToPs(2),
		holdPs: nsToPs(1),
		sequential: true
	};
}

function clockProfile(): TimingProfile {
	return {
		delayPs: 0,
		periodPs: nsToPs(20),
		duty: 0.5,
		clock: true
	};
}

export function timingDefaultsForKind(kind: string): TimingProfile {
	if (kind === 'clock') return clockProfile();
	if (SEQUENTIAL_KINDS.has(kind)) return sequentialProfile();
	if (kind === 'srLatch') return delayProfile(2);
	if (kind === 'fullAdder') return delayProfile(4);
	if (kind === 'halfAdder') return delayProfile(3);
	if (kind === 'rippleCarryAdder' || kind === 'magnitudeComparator') return delayProfile(6);
	if (COMBINATIONAL_KINDS.has(kind)) return delayProfile(2);
	if (MSI_KINDS.has(kind)) return delayProfile(3);
	if (ZERO_DELAY_KINDS.has(kind)) return zeroProfile();
	return zeroProfile();
}

export type TimingValidation =
	| { ok: true; value: number }
	| { ok: false; message: string };

export function validateTimingParam(
	kind: string,
	key: string,
	value: unknown
): TimingValidation {
	const fields = timingFieldsForKind(kind);
	if (!isTimingParam(key) || !fields.includes(key)) {
		return { ok: false, message: `${key} is not a timing parameter for ${kind}` };
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return { ok: false, message: `${key} must be a finite number, got ${String(value)}` };
	}
	if (key === 'duty') {
		if (value <= 0 || value >= 100) {
			return { ok: false, message: `duty must be greater than 0 and less than 100, got ${value}` };
		}
		return { ok: true, value };
	}
	if (key === 'period') {
		if (value <= 0) {
			return { ok: false, message: `period must be positive, got ${value}` };
		}
		return { ok: true, value };
	}
	if (value < 0) {
		return { ok: false, message: `${key} must be non-negative, got ${value}` };
	}
	return { ok: true, value };
}

function codeFor(key: TimingField): string {
	if (key === 'period') return 'invalid-clock-period';
	if (key === 'duty') return 'invalid-clock-duty';
	return 'invalid-timing-parameter';
}

function readTimingValue(
	kind: string,
	key: TimingField,
	params: Record<string, unknown> | undefined,
	fallback: number
): number {
	const raw = params?.[key];
	if (raw === undefined) return fallback;
	const result = validateTimingParam(kind, key, raw);
	if (!result.ok) throw new CompileError(result.message, codeFor(key));
	return result.value;
}

function rejectUnknownTimingKeys(
	kind: string,
	params: Record<string, unknown> | undefined
): void {
	if (!params) return;
	const fields = timingFieldsForKind(kind);
	for (const key of TIMING_PARAM_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
		if (params[key] === undefined) continue;
		if (!fields.includes(key)) {
			throw new CompileError(
				`${key} is not a timing parameter for ${kind}`,
				'invalid-timing-parameter'
			);
		}
	}
}

/**
 * Resolve the timing values for one component from its kind defaults and
 * explicit params. Time params are stored in nanoseconds; duty is stored as a
 * percentage and normalized to a fraction here.
 */
export function timingForComponent(
	kind: string,
	params?: Record<string, unknown>
): TimingProfile {
	rejectUnknownTimingKeys(kind, params);
	const defaults = timingDefaultsForKind(kind);
	const fields = timingFieldsForKind(kind);
	if (fields.length === 0) return defaults;

	if (fields.includes('delay')) {
		defaults.delayPs = nsToPs(readTimingValue(kind, 'delay', params, defaults.delayPs / 1000));
	}
	if (fields.includes('clockToQ')) {
		defaults.clockToQPs = nsToPs(
			readTimingValue(kind, 'clockToQ', params, (defaults.clockToQPs ?? 0) / 1000)
		);
	}
	if (fields.includes('setup')) {
		defaults.setupPs = nsToPs(readTimingValue(kind, 'setup', params, (defaults.setupPs ?? 0) / 1000));
	}
	if (fields.includes('hold')) {
		defaults.holdPs = nsToPs(readTimingValue(kind, 'hold', params, (defaults.holdPs ?? 0) / 1000));
	}
	if (fields.includes('period')) {
		defaults.periodPs = nsToPs(
			readTimingValue(kind, 'period', params, (defaults.periodPs ?? 0) / 1000)
		);
	}
	if (fields.includes('duty')) {
		defaults.duty = readTimingValue(kind, 'duty', params, (defaults.duty ?? 0) * 100) / 100;
	}
	return defaults;
}
