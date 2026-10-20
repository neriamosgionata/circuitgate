import { describe, expect, it } from 'vitest';
import { compileWithResolver, type KindResolver } from '../compile';
import { Simulator } from '../evaluate';
import { resolveComponentKind } from '../kinds';
import { primitiveKinds } from '../primitives';
import { bitsOf, document, inputsFor, outputsFor, prefixedNets, readBits } from './helpers';

const resolver: KindResolver = (kind, params) =>
	resolveComponentKind(kind, params) ?? primitiveKinds[kind] ?? null;

describe('per-component compile resolution', () => {
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

	it('starts each resolved register at unknown width', () => {
		const narrow = resolveComponentKind('register', { width: 4 })!;
		const wide = resolveComponentKind('register', { width: 16 })!;
		const doc = document([
			{ id: 'r1', kind: 'register', params: { width: 4 }, ...prefixedNets('r1', narrow) },
			{ id: 'r2', kind: 'register', params: { width: 16 }, ...prefixedNets('r2', wide) }
		]);
		const sim = new Simulator(doc, resolver);
		sim.settle();
		expect(readBits(sim, 'r1_q', 4)).toEqual(['X', 'X', 'X', 'X']);
		expect(readBits(sim, 'r2_q', 16)).toEqual(new Array(16).fill('X'));
	});
});

describe('32-bit families through the resolver', () => {
	it.each([
		['adds large values', 123456789, 987654321, 0],
		['carries out of 32 bits', 0xffffffff, 1, 1]
	] as const)('%s', (_label, a, b, carryOut) => {
		const kind = resolveComponentKind('rippleCarryAdder', { width: 32 })!;
		const doc = document([
			{ id: 'adder', kind: 'rippleCarryAdder', params: { width: 32 }, ...prefixedNets('adder', kind) }
		]);
		const sim = new Simulator(doc, resolver);
		bitsOf(a, 32).forEach((bit, i) => sim.setNet(`adder_a${i}`, bit));
		bitsOf(b, 32).forEach((bit, i) => sim.setNet(`adder_b${i}`, bit));
		sim.setNet('adder_cin', 0);
		expect(sim.settle().status).toBe('stable');
		expect(readBits(sim, 'adder_s', 32)).toEqual(bitsOf(a + b, 32));
		expect(sim.getNet('adder_cout')).toBe(carryOut);
	});

	it('compares at 32 bits', () => {
		const kind = resolveComponentKind('magnitudeComparator', { width: 32 })!;
		const doc = document([
			{ id: 'cmp', kind: 'magnitudeComparator', params: { width: 32 }, ...prefixedNets('cmp', kind) }
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
		const doc = document([
			{ id: 'reg', kind: 'register', params: { width: 32 }, ...prefixedNets('reg', kind) }
		]);
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
});

describe('static documents via the resolver', () => {
	it('matches the static registry for documents without parameterized kinds', () => {
		const doc = document([
			{ id: 'g', kind: 'and', inputs: inputsFor(primitiveKinds.and), outputs: outputsFor(primitiveKinds.and) }
		]);
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

	it('passes register-file options through the resolver', () => {
		const params = { addressBits: 1, wordBits: 4, registers: 1 };
		const kind = resolveComponentKind('registerFile', params)!;
		const doc = document([
			{ id: 'rf', kind: 'registerFile', params, ...prefixedNets('rf', kind) }
		]);
		const sim = new Simulator(doc, resolver);
		sim.setNet('rf_clk', 0);
		sim.setNet('rf_we', 1);
		sim.setNet('rf_wa0', 1);
		bitsOf(0b1010, 4).forEach((bit, i) => sim.setNet(`rf_wd${i}`, bit));
		sim.settle();
		sim.setNet('rf_clk', 1);
		sim.settle();
		sim.setNet('rf_we', 0);

		// Address 1 is inside the address space but outside the configured
		// register count, so the write above is ignored.
		sim.setNet('rf_ra0', 1);
		sim.settle();
		expect(readBits(sim, 'rf_qa', 4)).toEqual(['X', 'X', 'X', 'X']);
	});

	it('mixes static and parameterized components in one document', () => {
		const register = resolveComponentKind('register', { width: 4 })!;
		const doc = document([
			{ id: 'reg', kind: 'register', params: { width: 4 }, ...prefixedNets('reg', register) },
			{ id: 'gate', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } }
		]);
		const netlist = compileWithResolver(doc, resolver);
		expect(netlist.components.length).toBe(2);

		const sim = new Simulator(doc, resolver);
		sim.setNet('A', 1);
		sim.setNet('B', 0);
		sim.settle();
		expect(sim.getNet('Y')).toBe(0);
	});
});
