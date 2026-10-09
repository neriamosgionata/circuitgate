import { describe, expect, it } from 'vitest';
import { SYMBOL_PATHS, symbolKeyFor } from '../symbols';

const LOGIC_KINDS = [
	'and',
	'or',
	'not',
	'nand',
	'nor',
	'xor',
	'xnor',
	'buffer',
	'triStateBuffer',
	'switch',
	'probe',
	'led',
	'clock',
	'dFlipFlop',
	'jkFlipFlop',
	'srFlipFlop',
	'srLatch',
	'counter',
	'shiftRegister',
	'mux2',
	'mux4',
	'sevenSegDecoder',
	'sevenSegDisplay',
	'halfAdder',
	'fullAdder',
	'decoder2',
	'decoder3',
	'rom',
	'ram',
	'register',
	'registerFile',
	'rippleCarryAdder',
	'magnitudeComparator',
	'subcircuit'
];

const ANALOG_KINDS = [
	'vsource',
	'isource',
	'resistor',
	'capacitor',
	'inductor',
	'potentiometer',
	'switch',
	'diode',
	'led',
	'zener',
	'bjt',
	'mosfet',
	'idealOpamp',
	'opamp',
	'comparator',
	'timer555',
	'regulator',
	'ground'
];

describe('kind symbols', () => {
	it('resolves every known kind to itself with a drawn path', () => {
		for (const kind of [...LOGIC_KINDS, ...ANALOG_KINDS]) {
			expect(symbolKeyFor(kind)).toBe(kind);
			const path = SYMBOL_PATHS[kind];
			expect(path, kind).toBeTruthy();
			expect(path!.length, kind).toBeGreaterThan(10);
		}
	});

	it('shares family glyphs across parameterized logic kinds', () => {
		expect(symbolKeyFor('decoder5')).toBe('decoder2');
		expect(symbolKeyFor('rom8x8')).toBe('rom');
		expect(symbolKeyFor('ram16')).toBe('ram');
		expect(symbolKeyFor('register8')).toBe('register');
		expect(symbolKeyFor('registerFile4')).toBe('registerFile');
		expect(symbolKeyFor('rippleCarryAdder8')).toBe('rippleCarryAdder');
		expect(symbolKeyFor('magnitudeComparator4')).toBe('magnitudeComparator');
	});

	it('falls back to generic for unknown or future kinds', () => {
		expect(symbolKeyFor('fluxCapacitor')).toBe('generic');
		expect(SYMBOL_PATHS.generic).toBeTruthy();
	});

	it('keeps every path hand-drawn ASCII linework: no emoji, no unicode icons', () => {
		expect(Object.keys(SYMBOL_PATHS)).toContain('generic');
		for (const [kind, path] of Object.entries(SYMBOL_PATHS)) {
			expect(path, kind).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9 .,\-]+$/);
			for (const char of path) {
				expect(char.codePointAt(0)!, kind).toBeLessThan(128);
			}
		}
	});
});
