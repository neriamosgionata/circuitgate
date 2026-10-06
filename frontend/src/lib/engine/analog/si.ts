/**
 * Unambiguous SI-suffix parsing for analog value entry (U5). `m` is always
 * milli and `meg` is always mega; a bare `M` is rejected as ambiguous rather
 * than guessed. Invalid text is rejected, never coerced to NaN or zero.
 */
export type SIParseResult = { ok: true; value: number } | { ok: false; error: string };

const SINGLE_SUFFIXES: Readonly<Record<string, number>> = {
	f: 1e-15,
	p: 1e-12,
	n: 1e-9,
	u: 1e-6,
	'\u00b5': 1e-6,
	'\u03bc': 1e-6,
	m: 1e-3,
	k: 1e3,
	g: 1e9,
	t: 1e12
};

const MULTI_SUFFIXES: Readonly<Record<string, number>> = {
	meg: 1e6
};

const NUMBER_WITH_SUFFIX = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-z\u00b5\u03bc]+)$/;
const PLAIN_NUMBER = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;

export function parseSI(input: string): SIParseResult {
	const text = input.trim();
	if (text.length === 0) return { ok: false, error: 'empty value' };

	const plain = PLAIN_NUMBER.exec(text);
	if (plain) {
		const value = Number(plain[1]);
		return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'not a finite number' };
	}

	const match = NUMBER_WITH_SUFFIX.exec(text);
	if (!match) return { ok: false, error: 'invalid number' };

	const base = Number(match[1]);
	if (!Number.isFinite(base)) return { ok: false, error: 'not a finite number' };

	const suffix = match[2];
	const lower = suffix.toLowerCase();
	if (lower === 'm' && suffix !== 'm') {
		return { ok: false, error: 'ambiguous suffix: use "m" for milli or "meg" for mega' };
	}
	const scale = MULTI_SUFFIXES[lower] ?? SINGLE_SUFFIXES[lower];
	if (scale === undefined) return { ok: false, error: `unknown suffix: ${suffix}` };

	const value = base * scale;
	return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'not a finite number' };
}

export function formatSI(value: number): string {
	if (!Number.isFinite(value)) return '';
	if (value === 0) return '0';
	const magnitude = Math.abs(value);
	const units: readonly (readonly [number, string])[] = [
		[1e12, 'T'],
		[1e9, 'G'],
		[1e6, 'meg'],
		[1e3, 'k'],
		[1, ''],
		[1e-3, 'm'],
		[1e-6, 'u'],
		[1e-9, 'n'],
		[1e-12, 'p'],
		[1e-15, 'f']
	];
	for (const [scale, suffix] of units) {
		if (magnitude >= scale) {
			const scaled = value / scale;
			const text = Number.isInteger(scaled) ? String(scaled) : String(Number(scaled.toPrecision(6)));
			return `${text}${suffix}`;
		}
	}
	return String(value);
}
