import { describe, expect, it } from 'vitest';
import { Simulator } from '../evaluate';
import { sevenSegDecoderKind, sevenSegDisplay } from '../primitives/display';
import { bitsOf, document, inputsFor, outputsFor, type V } from './helpers';

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

function decoderSim(): Simulator {
	return new Simulator(
		document([
			{
				id: 'dec',
				kind: 'sevenSegDecoder',
				inputs: inputsFor(sevenSegDecoderKind),
				outputs: outputsFor(sevenSegDecoderKind)
			}
		]),
		{ sevenSegDecoder: sevenSegDecoderKind }
	);
}

function driveDigit(sim: Simulator, digit: number): void {
	bitsOf(digit, 4).forEach((bit, index) => sim.setNet(`d${index}`, bit));
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
		const sim = decoderSim();
		for (let digit = 0; digit <= 9; digit++) {
			driveDigit(sim, digit);
			expect(sim.settle().status).toBe('stable');
			expect(readSegments(sim), `digit ${digit}`).toEqual(DIGITS[digit]);
		}
	});

	it('blanks the display for out-of-range input', () => {
		const sim = decoderSim();
		driveDigit(sim, 0b1110);
		expect(readSegments(sim)).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});

	it('drives unknown on unknown inputs', () => {
		const sim = decoderSim();
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
