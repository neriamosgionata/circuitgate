import type { ComponentKind } from '../compile';
import type { LogicValue } from '../values';
import { bitPins, bitsToIndex } from './pins';

// BCD to seven-segment decoder, common-cathode active-high. Output pins carry
// the `s` prefix so segment nets read as sa..sg. A non-binary input drives
// every output X; a binary value above 9 blanks the display (all outputs 0).
const SEGMENT_MAP: ReadonlyArray<ReadonlyArray<0 | 1>> = [
	[1, 1, 1, 1, 1, 1, 0],
	[0, 1, 1, 0, 0, 0, 0],
	[1, 1, 0, 1, 1, 0, 1],
	[1, 1, 1, 1, 0, 0, 1],
	[0, 1, 1, 0, 0, 1, 1],
	[1, 0, 1, 1, 0, 1, 1],
	[1, 0, 1, 1, 1, 1, 1],
	[1, 1, 1, 0, 0, 0, 0],
	[1, 1, 1, 1, 1, 1, 1],
	[1, 1, 1, 1, 0, 1, 1]
];

export const sevenSegDecoderKind: ComponentKind = {
	inputs: bitPins('d', 4),
	outputs: ['sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg'],
	evaluate: (values) => {
		const digit = bitsToIndex(values);
		if (digit === undefined) {
			return { outputs: new Array<LogicValue>(7).fill('X') };
		}
		const segments = SEGMENT_MAP[digit] ?? [0, 0, 0, 0, 0, 0, 0];
		return { outputs: [...segments] };
	}
};

// Seven-segment display sink. Presentation lives in the canvas glyph; the
// engine only terminates the seven segment nets, like probe and LED.
export const sevenSegDisplay: ComponentKind = {
	inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
	outputs: [],
	evaluate: () => ({ outputs: [] })
};
