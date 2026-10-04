import { CompileError, type ComponentKind } from '../compile';
import type { LogicValue } from '../values';
import { risingEdgeDetected } from './flipflops';
import { bitPins, bitsToIndex, numberToBits, requirePositiveInteger, requireWordWidth, unknownBits } from './pins';

// Memories use one pin per bit and one state word per address: the engine has
// no multi-net bus values, so callers map each bit pin to its own net and read
// a word as a group of pins. Word widths are capped at 32 bits (see pins.ts).

function requireMemoryAddressBits(addressBits: number, label: string): void {
	requirePositiveInteger(addressBits, label);
	if (addressBits > 30) {
		throw new CompileError(`${label} must be at most 30, got ${addressBits}`, 'invalid-primitive-parameter');
	}
}

function memoryRead(address: number | undefined, words: readonly LogicValue[][], wordBits: number): LogicValue[] {
	if (address === undefined || address >= words.length) return unknownBits(wordBits);
	return [...words[address]];
}

export interface RomOptions {
	contents: readonly number[];
	wordBits: number;
}

export function romKind(options: RomOptions): ComponentKind {
	const { contents, wordBits } = options;
	requireWordWidth(wordBits);
	if (contents.length < 1 || (contents.length & (contents.length - 1)) !== 0) {
		throw new CompileError(`ROM contents length must be a power of two, got ${contents.length}`, 'invalid-rom-contents');
	}
	const capacity = 2 ** wordBits;
	contents.forEach((word, index) => {
		if (!Number.isInteger(word) || word < 0 || word >= capacity) {
			throw new CompileError(
				`ROM word ${index} (${word}) does not fit in ${wordBits} bits`,
				'invalid-rom-contents'
			);
		}
	});
	const addressBits = Math.log2(contents.length);
	const words = contents.map((word) => numberToBits(word, wordBits));
	return {
		inputs: bitPins('a', addressBits),
		outputs: bitPins('d', wordBits),
		evaluate: (values) => {
			const address = bitsToIndex(values);
			return { outputs: memoryRead(address, words, wordBits) };
		}
	};
}

export interface RamOptions {
	addressBits: number;
	wordBits: number;
}

interface RamState {
	words: LogicValue[][];
	lastClk?: LogicValue;
}

export function ramKind(options: RamOptions): ComponentKind {
	const { addressBits, wordBits } = options;
	requireMemoryAddressBits(addressBits, 'RAM address bits');
	requireWordWidth(wordBits);
	const size = 1 << addressBits;
	return {
		inputs: [...bitPins('a', addressBits), ...bitPins('d', wordBits), 'we', 'clk'],
		outputs: bitPins('q', wordBits),
		evaluate: (values, state) => {
			const previous = state as RamState | undefined;
			const words = previous?.words ?? Array.from({ length: size }, () => unknownBits(wordBits));
			const address = bitsToIndex(values.slice(0, addressBits));
			const data = values.slice(addressBits, addressBits + wordBits);
			const writeEnable = values[addressBits + wordBits];
			const clk = values[addressBits + wordBits + 1];
			// Read-before-write: outputs reflect the word stored before this edge;
			// the new word appears on the next delta cycle.
			const read = memoryRead(address, words, wordBits);
			let nextWords = words;
			if (risingEdgeDetected(previous?.lastClk, clk) && writeEnable === 1 && address !== undefined) {
				nextWords = words.map((word, index) => (index === address ? [...data] : word));
			}
			return { outputs: read, state: { words: nextWords, lastClk: clk } };
		}
	};
}

export interface RegisterFileOptions {
	addressBits: number;
	wordBits: number;
	registers?: number;
}

interface RegisterFileState {
	words: LogicValue[][];
	lastClk?: LogicValue;
}

// Two combinational read ports (ra -> qa, rb -> qb) and one synchronous write
// port (wa, wd, we) sampled on the rising clock edge per evaluation pass.
export function registerFileKind(options: RegisterFileOptions): ComponentKind {
	const { addressBits, wordBits } = options;
	requireMemoryAddressBits(addressBits, 'register file address bits');
	requireWordWidth(wordBits);
	const size = 1 << addressBits;
	const registers = options.registers ?? size;
	if (!Number.isInteger(registers) || registers < 1 || registers > size) {
		throw new CompileError(
			`register file registers must be between 1 and ${size}, got ${registers}`,
			'invalid-register-file-size'
		);
	}
	const dataPins = bitPins('wd', wordBits);
	const writeEnableIndex = addressBits * 3 + wordBits;
	const clockIndex = writeEnableIndex + 1;
	return {
		inputs: [
			...bitPins('ra', addressBits),
			...bitPins('rb', addressBits),
			...bitPins('wa', addressBits),
			...dataPins,
			'we',
			'clk'
		],
		outputs: [...bitPins('qa', wordBits), ...bitPins('qb', wordBits)],
		evaluate: (values, state) => {
			const previous = state as RegisterFileState | undefined;
			const words = previous?.words ?? Array.from({ length: registers }, () => unknownBits(wordBits));
			const readAddressA = bitsToIndex(values.slice(0, addressBits));
			const readAddressB = bitsToIndex(values.slice(addressBits, addressBits * 2));
			const writeAddress = bitsToIndex(values.slice(addressBits * 2, addressBits * 3));
			const writeData = values.slice(addressBits * 3, addressBits * 3 + wordBits);
			const writeEnable = values[writeEnableIndex];
			const clk = values[clockIndex];
			// Read-before-write on both ports, same convention as RAM.
			const readA = memoryRead(readAddressA, words, wordBits);
			const readB = memoryRead(readAddressB, words, wordBits);
			let nextWords = words;
			if (
				risingEdgeDetected(previous?.lastClk, clk) &&
				writeEnable === 1 &&
				writeAddress !== undefined &&
				writeAddress < registers
			) {
				nextWords = words.map((word, index) => (index === writeAddress ? [...writeData] : word));
			}
			return { outputs: [...readA, ...readB], state: { words: nextWords, lastClk: clk } };
		}
	};
}
