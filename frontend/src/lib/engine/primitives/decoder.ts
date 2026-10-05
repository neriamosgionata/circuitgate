import { CompileError, type ComponentKind } from '../compile';
import type { LogicValue } from '../values';
import { bitPins, bitsToIndex, requirePositiveInteger } from './pins';

const MAX_DECODER_BITS = 8;

// n-to-2^n decoder. Input a0 is the least significant address bit; output y0
// is selected by address 0. A non-binary address drives every output X.
export function decoderKind(bits: number): ComponentKind {
	requirePositiveInteger(bits, 'decoder address bits');
	if (bits > MAX_DECODER_BITS) {
		throw new CompileError(
			`decoder address bits must be at most ${MAX_DECODER_BITS}, got ${bits}`,
			'invalid-primitive-parameter'
		);
	}
	const outputPins = bitPins('y', 1 << bits);
	return {
		inputs: bitPins('a', bits),
		outputs: outputPins,
		evaluate: (values) => {
			const address = bitsToIndex(values);
			if (address === undefined) {
				return { outputs: outputPins.map<LogicValue>(() => 'X') };
			}
			return { outputs: outputPins.map<LogicValue>((_, index) => (index === address ? 1 : 0)) };
		}
	};
}
