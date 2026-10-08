import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { compileWithResolver, type KindResolver } from '../compile';
import { Simulator } from '../evaluate';
import { flatten } from '../hierarchy';
import { resolveComponentKind } from '../kinds';
import { primitiveKinds } from '../primitives';
import type { LogicValue } from '../values';

type V = LogicValue;

function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

function prefixedNets(
	id: string,
	kind: { inputs: readonly string[]; outputs: readonly string[] }
): { inputs: Record<string, string>; outputs: Record<string, string> } {
	const inputs: Record<string, string> = {};
	for (const pin of kind.inputs) inputs[pin] = `${id}_${pin}`;
	const outputs: Record<string, string> = {};
	for (const pin of kind.outputs) outputs[pin] = `${id}_${pin}`;
	return { inputs, outputs };
}

function bitsOf(value: number, width: number): V[] {
	const bits: V[] = [];
	for (let index = 0; index < width; index++) bits.push(((Math.floor(value / 2 ** index) % 2) as V));
	return bits;
}

function readBits(sim: Simulator, netPrefix: string, width: number): V[] {
	const bits: V[] = [];
	for (let index = 0; index < width; index++) bits.push(sim.getNet(`${netPrefix}${index}`) as V);
	return bits;
}

const resolver: KindResolver = (kind, params) =>
	resolveComponentKind(kind, params) ?? primitiveKinds[kind] ?? null;

describe('per-component compile resolution (U3)', () => {
	it('resolves two components sharing one kind with different params independently', () => {
		const narrow = resolveComponentKind('register', { width: 4 })!;
		const wide = resolveComponentKind('register', { width: 16 })!;
		const doc = document([
			{ id: 'r1', kind: 'register', params: { width: 4 }, ...prefixedNets('r1', narrow) },
			{ id: 'r2', kind: 'register', params: { width: 16 }, ...prefixedNets('r2', wide) }
		]);
		const netlist = compileWithResolver(doc, resolver);
		expect(netlist.components.length).toBe(2);
		const [c1, c2] = netlist.components;
		expect(c1.inputNets.length).toBe(1 + 4);
		expect(c1.outputNets.length).toBe(4);
		expect(c2.inputNets.length).toBe(1 + 16);
		expect(c2.outputNets.length).toBe(16);
	});

	it('drives a Simulator with a resolver function for mixed widths', () => {
		const narrow = resolveComponentKind('register', { width: 4 })!;
		const wide = resolveComponentKind('register', { width: 16 })!;
		const doc = document([
			{ id: 'r1', kind: 'register', params: { width: 4 }, ...prefixedNets('r1', narrow) },
			{ id: 'r2', kind: 'register', params: { width: 16 }, ...prefixedNets('r2', wide) }
		]);
		const sim = new Simulator(doc, resolver);
		sim.settle();
		expect(readBits(sim, 'r1_q', 4)).toEqual(['X', 'X', 'X', 'X']);
		expect(readBits(sim, 'r2_q', 16).length).toBe(16);
		expect(readBits(sim, 'r2_q', 16).every((bit) => bit === 'X')).toBe(true);
	});
});

describe('AE3 families at configured widths via resolver (U3)', () => {
	it('adds at 32 bits', () => {
		const kind = resolveComponentKind('rippleCarryAdder', { width: 32 })!;
		const nets = prefixedNets('adder', kind);
		const doc = document([{ id: 'adder', kind: 'rippleCarryAdder', params: { width: 32 }, ...nets }]);
		const sim = new Simulator(doc, resolver);
		const a = 123456789;
		const b = 987654321;
		bitsOf(a, 32).forEach((bit, i) => sim.setNet(`adder_a${i}`, bit));
		bitsOf(b, 32).forEach((bit, i) => sim.setNet(`adder_b${i}`, bit));
		sim.setNet('adder_cin', 0);
		expect(sim.settle().status).toBe('stable');
		expect(readBits(sim, 'adder_s', 32)).toEqual(bitsOf(a + b, 32));
		expect(sim.getNet('adder_cout')).toBe(0);
	});

	it('carries out at 32 bits', () => {
		const kind = resolveComponentKind('rippleCarryAdder', { width: 32 })!;
		const nets = prefixedNets('adder', kind);
		const doc = document([{ id: 'adder', kind: 'rippleCarryAdder', params: { width: 32 }, ...nets }]);
		const sim = new Simulator(doc, resolver);
		bitsOf(0xffffffff, 32).forEach((bit, i) => sim.setNet(`adder_a${i}`, bit));
		bitsOf(1, 32).forEach((bit, i) => sim.setNet(`adder_b${i}`, bit));
		sim.setNet('adder_cin', 0);
		sim.settle();
		expect(readBits(sim, 'adder_s', 32)).toEqual(bitsOf(0, 32));
		expect(sim.getNet('adder_cout')).toBe(1);
	});

	it('compares at 32 bits', () => {
		const kind = resolveComponentKind('magnitudeComparator', { width: 32 })!;
		const nets = prefixedNets('cmp', kind);
		const doc = document([
			{ id: 'cmp', kind: 'magnitudeComparator', params: { width: 32 }, ...nets }
		]);
		const sim = new Simulator(doc, resolver);
		bitsOf(2000000000, 32).forEach((bit, i) => sim.setNet(`cmp_a${i}`, bit));
		bitsOf(1000000000, 32).forEach((bit, i) => sim.setNet(`cmp_b${i}`, bit));
		sim.settle();
		expect(sim.getNet('cmp_gt')).toBe(1);
		expect(sim.getNet('cmp_lt')).toBe(0);
		expect(sim.getNet('cmp_eq')).toBe(0);
	});

	it('clocks a 32-bit register', () => {
		const kind = resolveComponentKind('register', { width: 32 })!;
		const nets = prefixedNets('reg', kind);
		const doc = document([{ id: 'reg', kind: 'register', params: { width: 32 }, ...nets }]);
		const sim = new Simulator(doc, resolver);
		sim.setNet('reg_clk', 0);
		sim.settle();
		const word = 0x12345678;
		bitsOf(word, 32).forEach((bit, i) => sim.setNet(`reg_d${i}`, bit));
		sim.settle();
		sim.setNet('reg_clk', 1);
		sim.settle();
		expect(readBits(sim, 'reg_q', 32)).toEqual(bitsOf(word, 32));
	});

	it('reads ROM initialized contents', () => {
		const contents = [9, 6, 0, 15];
		const kind = resolveComponentKind('rom', { contents, wordBits: 4 })!;
		const nets = prefixedNets('rom', kind);
		const doc = document([{ id: 'rom', kind: 'rom', params: { contents, wordBits: 4 }, ...nets }]);
		const sim = new Simulator(doc, resolver);
		for (let address = 0; address < contents.length; address++) {
			bitsOf(address, 2).forEach((bit, i) => sim.setNet(`rom_a${i}`, bit));
			sim.settle();
			expect(readBits(sim, 'rom_d', 4)).toEqual(bitsOf(contents[address], 4));
		}
	});

	it('writes then reads RAM across cycles', () => {
		const kind = resolveComponentKind('ram', { addressBits: 2, wordBits: 4 })!;
		const nets = prefixedNets('ram', kind);
		const doc = document([{ id: 'ram', kind: 'ram', params: { addressBits: 2, wordBits: 4 }, ...nets }]);
		const sim = new Simulator(doc, resolver);
		sim.setNet('ram_clk', 0);
		sim.setNet('ram_we', 0);
		sim.settle();
		const write = (address: number, word: number) => {
			bitsOf(address, 2).forEach((bit, i) => sim.setNet(`ram_a${i}`, bit));
			bitsOf(word, 4).forEach((bit, i) => sim.setNet(`ram_d${i}`, bit));
			sim.setNet('ram_we', 1);
			sim.setNet('ram_clk', 0);
			sim.settle();
			sim.setNet('ram_clk', 1);
			sim.settle();
			sim.setNet('ram_we', 0);
		};
		const read = (address: number): V[] => {
			bitsOf(address, 2).forEach((bit, i) => sim.setNet(`ram_a${i}`, bit));
			sim.settle();
			return readBits(sim, 'ram_q', 4);
		};
		write(1, 0b1010);
		write(0, 0b0011);
		expect(read(1)).toEqual([0, 1, 0, 1]);
		expect(read(0)).toEqual([1, 1, 0, 0]);
	});

	it('supports two reads and one write on the register file', () => {
		const kind = resolveComponentKind('registerFile', { addressBits: 2, wordBits: 4 })!;
		const nets = prefixedNets('rf', kind);
		const doc = document([
			{ id: 'rf', kind: 'registerFile', params: { addressBits: 2, wordBits: 4 }, ...nets }
		]);
		const sim = new Simulator(doc, resolver);
		sim.setNet('rf_clk', 0);
		sim.setNet('rf_we', 0);
		sim.settle();
		const write = (address: number, word: number) => {
			bitsOf(address, 2).forEach((bit, i) => sim.setNet(`rf_wa${i}`, bit));
			bitsOf(word, 4).forEach((bit, i) => sim.setNet(`rf_wd${i}`, bit));
			sim.setNet('rf_we', 1);
			sim.setNet('rf_clk', 0);
			sim.settle();
			sim.setNet('rf_clk', 1);
			sim.settle();
			sim.setNet('rf_we', 0);
		};
		const read = (port: 'qa' | 'qb', address: number): V[] => {
			const prefix = port === 'qa' ? 'rf_ra' : 'rf_rb';
			bitsOf(address, 2).forEach((bit, i) => sim.setNet(`${prefix}${i}`, bit));
			sim.settle();
			return readBits(sim, `rf_${port}`, 4);
		};
		write(2, 0b0110);
		write(1, 0b1001);
		expect(read('qa', 2)).toEqual([0, 1, 1, 0]);
		expect(read('qb', 2)).toEqual([0, 1, 1, 0]);
		expect(read('qa', 1)).toEqual([1, 0, 0, 1]);
	});
});

describe('AE4 static documents unchanged via resolver (U3)', () => {
	it('matches the static registry netlist for documents without parameterized kinds', () => {
		const andKind = primitiveKinds.and;
		const inputs: Record<string, string> = {};
		andKind.inputs.forEach((pin) => {
			inputs[pin] = pin;
		});
		const outputs: Record<string, string> = {};
		andKind.outputs.forEach((pin) => {
			outputs[pin] = pin;
		});
		const doc = document([{ id: 'g', kind: 'and', inputs, outputs }]);
		const viaResolver = new Simulator(doc, resolver);
		const viaStatic = new Simulator(doc, primitiveKinds);
		viaResolver.setNet('a', 1);
		viaResolver.setNet('b', 0);
		viaStatic.setNet('a', 1);
		viaStatic.setNet('b', 0);
		viaResolver.settle();
		viaStatic.settle();
		expect(viaResolver.getNet('out')).toBe(viaStatic.getNet('out'));
		expect(viaResolver.getNet('out')).toBe(0);
	});
});

describe('parameterized definitions flatten through the resolver (U3)', () => {
	it('simulates a wide register packaged in a definition', () => {
		const regKind = resolveComponentKind('register', { width: 8 })!;
		const regNets = prefixedNets('inner', regKind);
		const definitions = {
			wide: {
				name: 'wide',
				inputs: { clk: 'CLK', d0: 'D0' },
				outputs: { q0: 'Q0' },
				document: document([
					{
						id: 'inner',
						kind: 'register',
						params: { width: 8 },
						inputs: { clk: 'CLK', d0: 'D0', d1: 'D0', d2: 'D0', d3: 'D0', d4: 'D0', d5: 'D0', d6: 'D0', d7: 'D0' },
						outputs: {
							q0: 'Q0',
							q1: 'Q0',
							q2: 'Q0',
							q3: 'Q0',
							q4: 'Q0',
							q5: 'Q0',
							q6: 'Q0',
							q7: 'Q0'
						}
					}
				])
			}
		};
		void regNets;
		const top = document([
			{
				id: 'inst',
				kind: 'subcircuit',
				params: { definition: 'wide' },
				inputs: { clk: 'CLK', d0: 'D' },
				outputs: { q0: 'Q' }
			}
		]);
		const flat = flatten(top, definitions, resolver);
		expect(flat.components.length).toBe(1);
		expect(flat.components[0].kind).toBe('register');
		const sim = new Simulator(flat, resolver);
		sim.setNet('CLK', 0);
		sim.settle();
		sim.setNet('D', 1);
		sim.settle();
		sim.setNet('CLK', 1);
		sim.settle();
		expect(sim.getNet('Q')).toBe(1);
	});

	it('rejects invalid parameterized params inside definitions', () => {
		const definitions = {
			bad: {
				name: 'bad',
				inputs: { a: 'A' },
				outputs: { d: 'D' },
				document: document([
					{
						id: 'rom',
						kind: 'rom',
						params: { contents: [0, 1, 2], wordBits: 4 },
						inputs: { a0: 'A' },
						outputs: { d0: 'D', d1: 'D', d2: 'D', d3: 'D' }
					}
				])
			}
		};
		expect(() => flatten(document([]), definitions, resolver)).toThrow();
	});
});

describe('width changes reset state to unknown (U3)', () => {
	it('returns RAM state to unknown after a word-width change', () => {
		const narrow = resolveComponentKind('ram', { addressBits: 2, wordBits: 4 })!;
		const narrowNets = prefixedNets('ram', narrow);
		const narrowDoc = document([
			{ id: 'ram', kind: 'ram', params: { addressBits: 2, wordBits: 4 }, ...narrowNets }
		]);
		const first = new Simulator(narrowDoc, resolver);
		first.setNet('ram_clk', 0);
		first.setNet('ram_we', 1);
		bitsOf(1, 2).forEach((bit, i) => first.setNet(`ram_a${i}`, bit));
		bitsOf(0b1010, 4).forEach((bit, i) => first.setNet(`ram_d${i}`, bit));
		first.settle();
		first.setNet('ram_clk', 1);
		first.settle();
		bitsOf(1, 2).forEach((bit, i) => first.setNet(`ram_a${i}`, bit));
		first.settle();
		expect(readBits(first, 'ram_q', 4)).toEqual([0, 1, 0, 1]);

		const wide = resolveComponentKind('ram', { addressBits: 2, wordBits: 8 })!;
		const wideNets = prefixedNets('ram', wide);
		const wideDoc = document([
			{ id: 'ram', kind: 'ram', params: { addressBits: 2, wordBits: 8 }, ...wideNets }
		]);
		const second = new Simulator(wideDoc, resolver);
		second.setNet('ram_clk', 0);
		second.setNet('ram_we', 0);
		bitsOf(1, 2).forEach((bit, i) => second.setNet(`ram_a${i}`, bit));
		second.settle();
		expect(readBits(second, 'ram_q', 8).every((bit) => bit === 'X')).toBe(true);
	});

	it('returns register state to unknown after a width change', () => {
		const narrow = resolveComponentKind('register', { width: 4 })!;
		const narrowNets = prefixedNets('reg', narrow);
		const narrowDoc = document([
			{ id: 'reg', kind: 'register', params: { width: 4 }, ...narrowNets }
		]);
		const first = new Simulator(narrowDoc, resolver);
		first.setNet('reg_clk', 0);
		first.settle();
		bitsOf(0b1010, 4).forEach((bit, i) => first.setNet(`reg_d${i}`, bit));
		first.settle();
		first.setNet('reg_clk', 1);
		first.settle();
		expect(readBits(first, 'reg_q', 4)).toEqual([0, 1, 0, 1]);

		const wide = resolveComponentKind('register', { width: 8 })!;
		const wideNets = prefixedNets('reg', wide);
		const wideDoc = document([
			{ id: 'reg', kind: 'register', params: { width: 8 }, ...wideNets }
		]);
		const second = new Simulator(wideDoc, resolver);
		second.setNet('reg_clk', 0);
		second.settle();
		expect(readBits(second, 'reg_q', 8).every((bit) => bit === 'X')).toBe(true);
	});
});
