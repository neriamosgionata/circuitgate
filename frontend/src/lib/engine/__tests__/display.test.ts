import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { Simulator } from '../evaluate';
import { sevenSegDecoderKind, sevenSegDisplay } from '../primitives/display';
import type { LogicValue } from '../values';

type V = LogicValue;

function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

// Expected segment sets in a-g order, common-cathode active-high.
const DIGITS: Record<number, V[]> = {
	0: [1, 1, 1, 1, 1, 1, 0],
	1: [0, 1, 1, 0, 0, 0, 0],
	2: [1, 1, 0, 1, 1, 0, 1],
	3: [1, 1, 1, 1, 0, 0, 1],
	4: [0, 1, 1, 0, 0, 1, 1],
	5: [1, 0, 1, 1, 0, 1, 1],
	6: [1, 0, 1, 1, 1, 1, 1],
	7: [1, 1, 1, 0, 0, 0, 0],
	8: [1, 1, 1, 1, 1, 1, 1],
	9: [1, 1, 1, 1, 0, 1, 1]
};

function decoderOutputs(): Record<string, string> {
	return { sa: 'sa', sb: 'sb', sc: 'sc', sd: 'sd', se: 'se', sf: 'sf', sg: 'sg' };
}

function driveDigit(sim: Simulator, digit: number): void {
	for (let bit = 0; bit < 4; bit++) sim.setNet(`d${bit}`, ((digit >> bit) & 1) as V);
	sim.settle();
}

function readSegments(sim: Simulator): V[] {
	return SEGMENTS.map((segment) => sim.getNet(`s${segment}`) as V);
}

describe('seven-segment decoder', () => {
	it('exposes four BCD inputs and seven segment outputs', () => {
		const kind = sevenSegDecoderKind;
		expect([...kind.inputs]).toEqual(['d0', 'd1', 'd2', 'd3']);
		expect([...kind.outputs]).toEqual(['sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg']);
	});

	it('maps every BCD digit to its segment set', () => {
		const kind = sevenSegDecoderKind;
		const sim = new Simulator(
			document([
				{
					id: 'dec',
					kind: 'sevenSegDecoder',
					inputs: { d0: 'd0', d1: 'd1', d2: 'd2', d3: 'd3' },
					outputs: {
						sa: 'sa',
						sb: 'sb',
						sc: 'sc',
						sd: 'sd',
						se: 'se',
						sf: 'sf',
						sg: 'sg'
					}
				}
			]),
			{ sevenSegDecoder: kind }
		);
		for (let digit = 0; digit <= 9; digit++) {
			driveDigit(sim, digit);
			expect(sim.settle().status).toBe('stable');
			expect(
				SEGMENTS.map((segment) => sim.getNet(`s${segment}`)),
				`digit ${digit}`
			).toEqual(DIGITS[digit]);
		}
	});

	it('blanks the display for out-of-range input', () => {
		const kind = sevenSegDecoderKind;
		const sim = new Simulator(
			document([
				{
					id: 'dec',
					kind: 'sevenSegDecoder',
					inputs: { d0: 'd0', d1: 'd1', d2: 'd2', d3: 'd3' },
					outputs: decoderOutputs()
				}
			]),
			{ sevenSegDecoder: kind }
		);
		driveDigit(sim, 0b1110);
		expect(readSegments(sim)).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});

	it('drives unknown on unknown inputs', () => {
		const kind = sevenSegDecoderKind;
		const sim = new Simulator(
			document([
				{
					id: 'dec',
					kind: 'sevenSegDecoder',
					inputs: { d0: 'd0', d1: 'd1', d2: 'd2', d3: 'd3' },
					outputs: decoderOutputs()
				}
			]),
			{ sevenSegDecoder: kind }
		);
		sim.setNet('d0', 'X');
		sim.settle();
		expect(readSegments(sim)).toEqual(['X', 'X', 'X', 'X', 'X', 'X', 'X']);
	});
});

describe('seven-segment display', () => {
	it('is a seven-input sink with no outputs', () => {
		expect([...sevenSegDisplay.inputs]).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
		expect([...sevenSegDisplay.outputs]).toEqual([]);
		const result = sevenSegDisplay.evaluate!([1, 1, 1, 1, 1, 1, 0], undefined);
		expect(result.outputs).toEqual([]);
	});
});
