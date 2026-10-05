import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { CompileError } from '../compile';
import { Simulator } from '../evaluate';
import { ramKind, registerFileKind, romKind } from '../primitives/memory';
import type { LogicValue } from '../values';

type V = LogicValue;

function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

function inputsFor(kind: { inputs: readonly string[] }): Record<string, string> {
	const inputs: Record<string, string> = {};
	kind.inputs.forEach((pin) => {
		inputs[pin] = pin;
	});
	return inputs;
}

function outputsFor(kind: { outputs: readonly string[] }): Record<string, string> {
	const outputs: Record<string, string> = {};
	kind.outputs.forEach((pin) => {
		outputs[pin] = pin;
	});
	return outputs;
}

function bitsOf(value: number, width: number): V[] {
	const bits: V[] = [];
	for (let index = 0; index < width; index++) bits.push(((value >> index) & 1) as V);
	return bits;
}

function readBits(sim: Simulator, prefix: string, width: number): V[] {
	const bits: V[] = [];
	for (let index = 0; index < width; index++) bits.push(sim.getNet(`${prefix}${index}`) as V);
	return bits;
}

function expectBits(actual: V[], expected: V[], label: string): void {
	expect(actual, label).toEqual(expected);
}

describe('ROM primitives', () => {
	it('returns initialized contents for every address', () => {
		const kind = romKind({ contents: [0b1010, 0b0101, 0b1111, 0b0000], wordBits: 4 });
		const sim = new Simulator(
			document([{ id: 'rom', kind: 'rom', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ rom: kind }
		);
		const contents = [0b1010, 0b0101, 0b1111, 0b0000];
		for (let address = 0; address < contents.length; address++) {
			const bits = bitsOf(address, 2);
			sim.setNet('a0', bits[0]);
			sim.setNet('a1', bits[1]);
			expect(sim.settle().status).toBe('stable');
			expectBits(readBits(sim, 'd', 4), bitsOf(contents[address], 4), `ROM address ${address}`);
		}
	});

	it('drives X when the address is unknown', () => {
		const kind = romKind({ contents: [0, 1], wordBits: 1 });
		const sim = new Simulator(
			document([{ id: 'rom', kind: 'rom', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ rom: kind }
		);
		sim.setNet('a0', 'X');
		sim.settle();
		expect(sim.getNet('d0')).toBe('X');
	});

	it('rejects malformed ROM configurations', () => {
		expect(() => romKind({ contents: [0, 1, 2], wordBits: 4 })).toThrow(CompileError);
		expect(() => romKind({ contents: [0, 16], wordBits: 4 })).toThrow(CompileError);
		expect(() => romKind({ contents: [0], wordBits: 0 })).toThrow(CompileError);
		expect(() => romKind({ contents: [0], wordBits: 4.5 })).toThrow(CompileError);
	});
});

describe('RAM primitives', () => {
	function ramSim(addressBits = 2, wordBits = 4): Simulator {
		const kind = ramKind({ addressBits, wordBits });
		return new Simulator(
			document([{ id: 'ram', kind: 'ram', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ ram: kind }
		);
	}

	function setAddress(sim: Simulator, address: number, addressBits: number): void {
		const bits = bitsOf(address, addressBits);
		bits.forEach((bit, index) => sim.setNet(`a${index}`, bit));
	}

	function writeWord(sim: Simulator, address: number, word: number, addressBits: number, wordBits: number): void {
		setAddress(sim, address, addressBits);
		bitsOf(word, wordBits).forEach((bit, index) => sim.setNet(`d${index}`, bit));
		sim.setNet('we', 1);
		sim.setNet('clk', 0);
		sim.settle();
		sim.setNet('clk', 1);
		sim.settle();
		sim.setNet('we', 0);
	}

	function readWord(sim: Simulator, address: number, addressBits: number, wordBits: number): V[] {
		setAddress(sim, address, addressBits);
		sim.settle();
		return readBits(sim, 'q', wordBits);
	}

	it('starts with unknown contents and writes then reads across clock cycles', () => {
		const sim = ramSim();
		sim.setNet('clk', 0);
		sim.setNet('we', 0);
		sim.settle();
		expectBits(readWord(sim, 0, 2, 4), ['X', 'X', 'X', 'X'], 'initial RAM content');

		writeWord(sim, 1, 0b1010, 2, 4);
		writeWord(sim, 0, 0b0011, 2, 4);

		expectBits(readWord(sim, 1, 2, 4), [0, 1, 0, 1], 'RAM address 1');
		expectBits(readWord(sim, 0, 2, 4), [1, 1, 0, 0], 'RAM address 0');
		expectBits(readWord(sim, 3, 2, 4), ['X', 'X', 'X', 'X'], 'untouched RAM address');
	});

	it('ignores writes while write-enable is low', () => {
		const sim = ramSim();
		sim.setNet('clk', 0);
		sim.setNet('we', 0);
		sim.settle();
		writeWord(sim, 2, 0b1001, 2, 4);

		bitsOf(0b1111, 4).forEach((bit, index) => sim.setNet(`d${index}`, bit));
		sim.setNet('we', 0);
		sim.setNet('clk', 0);
		sim.settle();
		sim.setNet('clk', 1);
		sim.settle();

		expectBits(readWord(sim, 2, 2, 4), [1, 0, 0, 1], 'RAM after disabled write');
	});

	it('drives X for unknown read addresses', () => {
		const sim = ramSim();
		sim.setNet('clk', 0);
		sim.setNet('we', 0);
		sim.settle();
		sim.setNet('a0', 'X');
		sim.settle();
		expectBits(readBits(sim, 'q', 4), ['X', 'X', 'X', 'X'], 'unknown RAM address');
	});

	it('rejects malformed RAM configurations', () => {
		expect(() => ramKind({ addressBits: 0, wordBits: 4 })).toThrow(CompileError);
		expect(() => ramKind({ addressBits: 2, wordBits: 0 })).toThrow(CompileError);
		expect(() => ramKind({ addressBits: 2, wordBits: 64 })).toThrow(CompileError);
	});
});

describe('register files', () => {
	function registerFileSim(registers = 4): Simulator {
		const kind = registerFileKind({ addressBits: 2, wordBits: 4, registers });
		return new Simulator(
			document([{ id: 'rf', kind: 'registerFile', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ registerFile: kind }
		);
	}

	function writeRegister(sim: Simulator, address: number, word: number): void {
		bitsOf(address, 2).forEach((bit, index) => sim.setNet(`wa${index}`, bit));
		bitsOf(word, 4).forEach((bit, index) => sim.setNet(`wd${index}`, bit));
		sim.setNet('we', 1);
		sim.setNet('clk', 0);
		sim.settle();
		sim.setNet('clk', 1);
		sim.settle();
		sim.setNet('we', 0);
	}

	function read(sim: Simulator, port: 'qa' | 'qb', address: number): V[] {
		const prefix = port === 'qa' ? 'ra' : 'rb';
		bitsOf(address, 2).forEach((bit, index) => sim.setNet(`${prefix}${index}`, bit));
		sim.settle();
		return readBits(sim, port, 4);
	}

	it('supports two reads and one write per cycle', () => {
		const sim = registerFileSim();
		sim.setNet('clk', 0);
		sim.setNet('we', 0);
		sim.settle();

		expectBits(read(sim, 'qa', 0), ['X', 'X', 'X', 'X'], 'initial register 0');
		expectBits(read(sim, 'qb', 1), ['X', 'X', 'X', 'X'], 'initial register 1');

		writeRegister(sim, 2, 0b0110);
		writeRegister(sim, 1, 0b1001);

		expectBits(read(sim, 'qa', 2), [0, 1, 1, 0], 'register 2 read port A');
		expectBits(read(sim, 'qb', 2), [0, 1, 1, 0], 'register 2 read port B');
		expectBits(read(sim, 'qa', 1), [1, 0, 0, 1], 'register 1 read port A');
		expectBits(read(sim, 'qb', 3), ['X', 'X', 'X', 'X'], 'untouched register 3');
	});

	it('ignores writes while write-enable is low', () => {
		const sim = registerFileSim();
		sim.setNet('clk', 0);
		sim.setNet('we', 0);
		sim.settle();
		writeRegister(sim, 0, 0b0011);

		bitsOf(0b1100, 4).forEach((bit, index) => sim.setNet(`wd${index}`, bit));
		sim.setNet('wa0', 0);
		sim.setNet('wa1', 0);
		sim.setNet('we', 0);
		sim.setNet('clk', 0);
		sim.settle();
		sim.setNet('clk', 1);
		sim.settle();
		expectBits(read(sim, 'qa', 0), [1, 1, 0, 0], 'register 0 after disabled write');
	});

	it('drives X for addresses without a register', () => {
		const sim = registerFileSim(3);
		sim.setNet('clk', 0);
		sim.setNet('we', 0);
		sim.settle();
		expectBits(read(sim, 'qa', 3), ['X', 'X', 'X', 'X'], 'address without register');
	});

	it('rejects malformed register-file configurations', () => {
		expect(() => registerFileKind({ addressBits: 1, wordBits: 4, registers: 4 })).toThrow(CompileError);
		expect(() => registerFileKind({ addressBits: 2, wordBits: 0 })).toThrow(CompileError);
		expect(() => registerFileKind({ addressBits: 2, wordBits: 64 })).toThrow(CompileError);
	});
});
