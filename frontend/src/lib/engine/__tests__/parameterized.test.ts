import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { compile, CompileError } from '../compile';
import { Simulator } from '../evaluate';
import {
	PARAMETERIZED_FAMILY_KINDS,
	defaultParamsForKind,
	kindsForDocument,
	resolveComponentKind,
	resolveKind
} from '../kinds';
import { primitiveKinds } from '../primitives';
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

describe('parameterized kind resolution', () => {
	it('covers all six families', () => {
		expect([...PARAMETERIZED_FAMILY_KINDS].sort()).toEqual(
			['magnitudeComparator', 'ram', 'register', 'registerFile', 'rippleCarryAdder', 'rom'].sort()
		);
		for (const family of PARAMETERIZED_FAMILY_KINDS) {
			expect(resolveComponentKind(family), family).not.toBeNull();
		}
	});

	it.each([1, 8, 16, 32])('resolves ripple adder pins at width %i', (width) => {
		const kind = resolveComponentKind('rippleCarryAdder', { width })!;
		expect(kind).not.toBeNull();
		expect([...kind.inputs]).toEqual([
			...Array.from({ length: width }, (_, i) => `a${i}`),
			...Array.from({ length: width }, (_, i) => `b${i}`),
			'cin'
		]);
		expect([...kind.outputs]).toEqual([...Array.from({ length: width }, (_, i) => `s${i}`), 'cout']);
	});

	it.each([1, 8, 16, 32])('resolves comparator pins at width %i', (width) => {
		const kind = resolveComponentKind('magnitudeComparator', { width })!;
		expect([...kind.inputs]).toEqual([
			...Array.from({ length: width }, (_, i) => `a${i}`),
			...Array.from({ length: width }, (_, i) => `b${i}`)
		]);
		expect([...kind.outputs]).toEqual(['eq', 'gt', 'lt']);
	});

	it.each([1, 8, 16, 32])('resolves register pins at width %i', (width) => {
		const kind = resolveComponentKind('register', { width })!;
		expect([...kind.inputs]).toEqual(['clk', ...Array.from({ length: width }, (_, i) => `d${i}`)]);
		expect([...kind.outputs]).toEqual(Array.from({ length: width }, (_, i) => `q${i}`));
	});

	it.each([1, 8, 16, 32])('resolves RAM pins at word width %i', (wordBits) => {
		const kind = resolveComponentKind('ram', { addressBits: 2, wordBits })!;
		expect([...kind.inputs]).toEqual([
			...Array.from({ length: 2 }, (_, i) => `a${i}`),
			...Array.from({ length: wordBits }, (_, i) => `d${i}`),
			'we',
			'clk'
		]);
		expect([...kind.outputs]).toEqual(Array.from({ length: wordBits }, (_, i) => `q${i}`));
	});

	it.each([1, 8, 16, 32])('resolves register-file pins at word width %i', (wordBits) => {
		const kind = resolveComponentKind('registerFile', { addressBits: 2, wordBits })!;
		expect([...kind.inputs]).toEqual([
			...Array.from({ length: 2 }, (_, i) => `ra${i}`),
			...Array.from({ length: 2 }, (_, i) => `rb${i}`),
			...Array.from({ length: 2 }, (_, i) => `wa${i}`),
			...Array.from({ length: wordBits }, (_, i) => `wd${i}`),
			'we',
			'clk'
		]);
		expect([...kind.outputs]).toEqual([
			...Array.from({ length: wordBits }, (_, i) => `qa${i}`),
			...Array.from({ length: wordBits }, (_, i) => `qb${i}`)
		]);
	});

	it.each([1, 8, 16, 32])('resolves ROM pins at word width %i', (wordBits) => {
		const kind = resolveComponentKind('rom', { contents: [0, 0, 0, 0], wordBits })!;
		expect([...kind.inputs]).toEqual(['a0', 'a1']);
		expect([...kind.outputs]).toEqual(Array.from({ length: wordBits }, (_, i) => `d${i}`));
	});

	it('resolves bare family kinds to the KTD5 defaults', () => {
		const adder = resolveComponentKind('rippleCarryAdder')!;
		expect([...adder.inputs].length).toBe(2 * 8 + 1);
		expect([...adder.outputs].length).toBe(8 + 1);

		const comparator = resolveComponentKind('magnitudeComparator')!;
		expect([...comparator.inputs].length).toBe(2 * 8);
		expect([...comparator.outputs]).toEqual(['eq', 'gt', 'lt']);

		const register = resolveComponentKind('register')!;
		expect([...register.inputs]).toEqual(['clk', ...Array.from({ length: 8 }, (_, i) => `d${i}`)]);
		expect([...register.outputs]).toEqual(Array.from({ length: 8 }, (_, i) => `q${i}`));

		const ram = resolveComponentKind('ram')!;
		expect([...ram.inputs].length).toBe(4 + 8 + 2);
		expect([...ram.outputs].length).toBe(8);

		const registerFile = resolveComponentKind('registerFile')!;
		expect([...registerFile.inputs].length).toBe(4 * 3 + 8 + 2);
		expect([...registerFile.outputs].length).toBe(2 * 8);

		const rom = resolveComponentKind('rom')!;
		expect([...rom.inputs]).toEqual(['a0', 'a1', 'a2', 'a3']);
		expect([...rom.outputs].length).toBe(8);

		expect(defaultParamsForKind('rippleCarryAdder')).toEqual({ width: 8 });
		expect(defaultParamsForKind('magnitudeComparator')).toEqual({ width: 8 });
		expect(defaultParamsForKind('register')).toEqual({ width: 8 });
		expect(defaultParamsForKind('ram')).toEqual({ addressBits: 4, wordBits: 8 });
		expect(defaultParamsForKind('registerFile')).toEqual({ addressBits: 4, wordBits: 8 });
		expect(defaultParamsForKind('rom')).toEqual({ contents: new Array(16).fill(0), wordBits: 8 });
	});

	it('clamps out-of-range widths to 1–32 instead of throwing', () => {
		expect([...resolveComponentKind('rippleCarryAdder', { width: 0 })!.inputs].length).toBe(2 * 1 + 1);
		expect([...resolveComponentKind('register', { width: 100 })!.outputs].length).toBe(32);
		expect([...resolveComponentKind('magnitudeComparator', { width: 64 })!.inputs].length).toBe(2 * 32);
	});

	it('derives ROM depth from contents length and ignores direct depth edits', () => {
		const two = resolveComponentKind('rom', { contents: [1, 2], wordBits: 8 })!;
		expect([...two.inputs]).toEqual(['a0']);
		const withDepth = resolveComponentKind('rom', {
			addressBits: 4,
			contents: [1, 2],
			depth: 16,
			wordBits: 8
		})!;
		expect([...withDepth.inputs]).toEqual(['a0']);
	});

	it('keeps addressBits and wordBits independent', () => {
		const kind = resolveComponentKind('ram', { addressBits: 2, wordBits: 16 })!;
		expect([...kind.inputs].filter((pin) => pin.startsWith('a')).length).toBe(2);
		expect([...kind.outputs].length).toBe(16);
	});

	it('surfaces engine errors for invalid parameters', () => {
		expect(() => resolveComponentKind('rom', { contents: [0, 1, 2], wordBits: 4 })).toThrow(CompileError);
		expect(() => resolveComponentKind('rom', { contents: [0, 16], wordBits: 4 })).toThrow(CompileError);
		expect(() => resolveComponentKind('ram', { addressBits: 31, wordBits: 8 })).toThrow(CompileError);
		expect(() => resolveComponentKind('registerFile', { addressBits: 31, wordBits: 8 })).toThrow(CompileError);
		expect(() => resolveComponentKind('ram', { addressBits: 2, wordBits: 64 })).toThrow(CompileError);
		expect(() => resolveComponentKind('ram', { addressBits: 0, wordBits: 8 })).toThrow(CompileError);
	});

	it('falls back to the static registry and leaves static kinds unchanged', () => {
		const andKind = resolveComponentKind('and')!;
		expect([...andKind.inputs]).toEqual([...primitiveKinds.and.inputs]);
		expect([...andKind.outputs]).toEqual([...primitiveKinds.and.outputs]);
		expect(resolveComponentKind('does-not-exist')).toBeNull();
		const andPinout = resolveKind('and', 'logic')!;
		expect([...andPinout.inputs]).toEqual([...primitiveKinds.and.inputs]);
		expect([...andPinout.outputs]).toEqual([...primitiveKinds.and.outputs]);
		expect(resolveKind('rippleCarryAdder', 'logic')).not.toBeNull();
	});

	it('compiles seeded documents through per-component resolution for all six families', () => {
		const families: Array<{ kind: string; params?: Record<string, unknown> }> = [
			{ kind: 'rippleCarryAdder', params: { width: 4 } },
			{ kind: 'magnitudeComparator', params: { width: 4 } },
			{ kind: 'register', params: { width: 4 } },
			{ kind: 'registerFile', params: { addressBits: 2, wordBits: 4 } },
			{ kind: 'ram', params: { addressBits: 2, wordBits: 4 } },
			{ kind: 'rom', params: { contents: [1, 2, 3, 4], wordBits: 4 } }
		];
		const components = families.map(({ kind, params }, index) => {
			const resolved = resolveComponentKind(kind, params)!;
			return {
				id: `c${index}`,
				kind,
				params,
				inputs: inputsFor(resolved),
				outputs: outputsFor(resolved)
			};
		});
		const doc = document(components);
		const kinds = kindsForDocument(doc);
		const netlist = compile(doc, kinds);
		expect(netlist.components.length).toBe(6);
	});

	it('compiles seeded defaults for all six families with no params', () => {
		const components = PARAMETERIZED_FAMILY_KINDS.map((kind, index) => {
			const resolved = resolveComponentKind(kind)!;
			return { id: `d${index}`, kind, inputs: inputsFor(resolved), outputs: outputsFor(resolved) };
		});
		const doc = document(components);
		expect(() => compile(doc, kindsForDocument(doc))).not.toThrow();
	});

	it('round-trips documents without parameterized kinds unchanged', () => {
		const andKind = primitiveKinds.and;
		const doc = document([{ id: 'g', kind: 'and', inputs: inputsFor(andKind), outputs: outputsFor(andKind) }]);
		const viaResolver = compile(doc, kindsForDocument(doc));
		const viaStatic = compile(doc, primitiveKinds);
		expect(viaResolver.components.length).toBe(viaStatic.components.length);
		expect(viaResolver.netIds).toEqual(viaStatic.netIds);
	});

	it('simulates every family at its configured width through the resolver', () => {
		const adderKind = resolveComponentKind('rippleCarryAdder', { width: 8 })!;
		const adderDoc = document([
			{ id: 'adder', kind: 'rippleCarryAdder', params: { width: 8 }, inputs: inputsFor(adderKind), outputs: outputsFor(adderKind) }
		]);
		const adderSim = new Simulator(adderDoc, kindsForDocument(adderDoc));
		[...bitsOf(15, 8)].forEach((bit, i) => adderSim.setNet(`a${i}`, bit));
		[...bitsOf(27, 8)].forEach((bit, i) => adderSim.setNet(`b${i}`, bit));
		adderSim.setNet('cin', 1);
		expect(adderSim.settle().status).toBe('stable');
		expect(readBits(adderSim, 's', 8)).toEqual(bitsOf(15 + 27 + 1, 8));
		expect(adderSim.getNet('cout')).toBe(0);

		const cmpKind = resolveComponentKind('magnitudeComparator', { width: 4 })!;
		const cmpDoc = document([
			{ id: 'cmp', kind: 'magnitudeComparator', params: { width: 4 }, inputs: inputsFor(cmpKind), outputs: outputsFor(cmpKind) }
		]);
		const cmpSim = new Simulator(cmpDoc, kindsForDocument(cmpDoc));
		[...bitsOf(9, 4)].forEach((bit, i) => cmpSim.setNet(`a${i}`, bit));
		[...bitsOf(6, 4)].forEach((bit, i) => cmpSim.setNet(`b${i}`, bit));
		cmpSim.settle();
		expect(cmpSim.getNet('gt')).toBe(1);

		const romKind = resolveComponentKind('rom', { contents: [9, 6, 0, 0], wordBits: 4 })!;
		const romDoc = document([
			{ id: 'rom', kind: 'rom', params: { contents: [9, 6, 0, 0], wordBits: 4 }, inputs: inputsFor(romKind), outputs: outputsFor(romKind) }
		]);
		const romSim = new Simulator(romDoc, kindsForDocument(romDoc));
		romSim.setNet('a0', 0);
		romSim.setNet('a1', 0);
		romSim.settle();
		expect(readBits(romSim, 'd', 4)).toEqual(bitsOf(9, 4));

		const ramKind = resolveComponentKind('ram', { addressBits: 2, wordBits: 4 })!;
		const ramDoc = document([
			{ id: 'ram', kind: 'ram', params: { addressBits: 2, wordBits: 4 }, inputs: inputsFor(ramKind), outputs: outputsFor(ramKind) }
		]);
		const ramSim = new Simulator(ramDoc, kindsForDocument(ramDoc));
		ramSim.setNet('clk', 0);
		ramSim.setNet('we', 0);
		ramSim.settle();
		[...bitsOf(2, 2)].forEach((bit, i) => ramSim.setNet(`a${i}`, bit));
		[...bitsOf(0b1010, 4)].forEach((bit, i) => ramSim.setNet(`d${i}`, bit));
		ramSim.setNet('we', 1);
		ramSim.setNet('clk', 0);
		ramSim.settle();
		ramSim.setNet('clk', 1);
		ramSim.settle();
		ramSim.setNet('we', 0);
		ramSim.settle();
		expect(readBits(ramSim, 'q', 4)).toEqual(bitsOf(0b1010, 4));
	});
});
