import { describe, expect, it } from 'vitest';
import { compileWithResolver, CompileError } from '../compile';
import { Simulator } from '../evaluate';
import {
	PARAMETERIZED_FAMILY_KINDS,
	defaultParamsForKind,
	parameterShapeFor,
	pinoutForParameterizedKind,
	resolveComponentKind,
	resolveKind
} from '../kinds';
import { primitiveKinds } from '../primitives';
import { bitsOf, clock, document, inputsFor, outputsFor, prefixedNets, readBits } from './helpers';

describe('parameterized kind resolution', () => {
	it('registers every family with resolvable defaults', () => {
		expect([...PARAMETERIZED_FAMILY_KINDS].sort()).toEqual(
			['counter', 'magnitudeComparator', 'ram', 'register', 'registerFile', 'rippleCarryAdder', 'rom', 'shiftRegister'].sort()
		);
		for (const family of PARAMETERIZED_FAMILY_KINDS) {
			const params = defaultParamsForKind(family);
			expect(params, family).not.toBeNull();
			const kind = resolveComponentKind(family, params ?? undefined);
			expect(kind, family).not.toBeNull();
			const pinout = pinoutForParameterizedKind(family, params ?? undefined);
			expect(pinout, family).not.toBeNull();
			expect([...pinout!.inputs], family).toEqual([...kind!.inputs]);
			expect([...pinout!.outputs], family).toEqual([...kind!.outputs]);
		}
	});

	const pinCases: Array<[string, Record<string, unknown>, { inputs: string[]; outputs: string[] }]> = [
		[
			'rippleCarryAdder',
			{ width: 4 },
			{
				inputs: ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3', 'cin'],
				outputs: ['s0', 's1', 's2', 's3', 'cout']
			}
		],
		[
			'magnitudeComparator',
			{ width: 4 },
			{
				inputs: ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3'],
				outputs: ['eq', 'gt', 'lt']
			}
		],
		[
			'register',
			{ width: 4 },
			{ inputs: ['clk', 'd0', 'd1', 'd2', 'd3'], outputs: ['q0', 'q1', 'q2', 'q3'] }
		],
		[
			'counter',
			{ width: 4 },
			{
				inputs: ['clk', 'reset', 'enable', 'load', 'd0', 'd1', 'd2', 'd3'],
				outputs: ['q0', 'q1', 'q2', 'q3']
			}
		],
		[
			'shiftRegister',
			{ width: 4 },
			{
				inputs: ['clk', 'reset', 'load', 'sin', 'd0', 'd1', 'd2', 'd3'],
				outputs: ['q0', 'q1', 'q2', 'q3']
			}
		],
		[
			'registerFile',
			{ addressBits: 2, wordBits: 4 },
			{
				inputs: [
					'ra0',
					'ra1',
					'rb0',
					'rb1',
					'wa0',
					'wa1',
					'wd0',
					'wd1',
					'wd2',
					'wd3',
					'we',
					'clk'
				],
				outputs: ['qa0', 'qa1', 'qa2', 'qa3', 'qb0', 'qb1', 'qb2', 'qb3']
			}
		],
		[
			'ram',
			{ addressBits: 2, wordBits: 4 },
			{ inputs: ['a0', 'a1', 'd0', 'd1', 'd2', 'd3', 'we', 'clk'], outputs: ['q0', 'q1', 'q2', 'q3'] }
		],
		[
			'rom',
			{ contents: [0, 1, 2, 3], wordBits: 4 },
			{ inputs: ['a0', 'a1'], outputs: ['d0', 'd1', 'd2', 'd3'] }
		]
	];

	it.each(pinCases)('publishes stable pin names for %s', (kind, params, expected) => {
		const resolved = resolveComponentKind(kind, params)!;
		expect({ inputs: [...resolved.inputs], outputs: [...resolved.outputs] }).toEqual(expected);
		const pinout = pinoutForParameterizedKind(kind, params)!;
		expect({ inputs: [...pinout.inputs], outputs: [...pinout.outputs] }).toEqual(expected);
	});

	it('classifies each family for the editor controls', () => {
		for (const family of ['rippleCarryAdder', 'magnitudeComparator', 'register', 'counter', 'shiftRegister']) {
			expect(parameterShapeFor(family), family).toBe('width');
		}
		for (const family of ['ram', 'registerFile']) {
			expect(parameterShapeFor(family), family).toBe('memory');
		}
		expect(parameterShapeFor('rom')).toBe('rom');
		expect(parameterShapeFor('and')).toBeNull();
	});

	it('uses the shared defaults and returns fresh parameter objects', () => {
		expect(defaultParamsForKind('rippleCarryAdder')).toEqual({ width: 8 });
		expect(defaultParamsForKind('magnitudeComparator')).toEqual({ width: 8 });
		expect(defaultParamsForKind('register')).toEqual({ width: 8 });
		expect(defaultParamsForKind('counter')).toEqual({ width: 8 });
		expect(defaultParamsForKind('shiftRegister')).toEqual({ width: 8 });
		expect(defaultParamsForKind('ram')).toEqual({ addressBits: 4, wordBits: 8 });
		expect(defaultParamsForKind('registerFile')).toEqual({ addressBits: 4, wordBits: 8 });
		expect(defaultParamsForKind('rom')).toEqual({ contents: new Array(16).fill(0), wordBits: 8 });

		const mutable = defaultParamsForKind('rom')!;
		(mutable['contents'] as number[])[0] = 7;
		expect(defaultParamsForKind('rom')).toEqual({ contents: new Array(16).fill(0), wordBits: 8 });
	});

	it.each([0, 33, 64, 4.5])('rejects unsupported width %s', (width) => {
		for (const family of ['rippleCarryAdder', 'magnitudeComparator', 'register', 'counter', 'shiftRegister']) {
			expect(() => resolveComponentKind(family, { width }), family).toThrow(CompileError);
		}
		expect(() => resolveComponentKind('ram', { addressBits: 2, wordBits: width })).toThrow(CompileError);
		expect(() => resolveComponentKind('rom', { contents: [0], wordBits: width })).toThrow(CompileError);
	});

	it('rejects malformed parameters with engine errors', () => {
		expect(() => resolveComponentKind('register', { width: 'x' })).toThrow(CompileError);
		expect(() => resolveComponentKind('ram', { addressBits: 0, wordBits: 8 })).toThrow(CompileError);
		expect(() => resolveComponentKind('ram', { addressBits: 31, wordBits: 8 })).toThrow(CompileError);
		expect(() =>
			resolveComponentKind('registerFile', { addressBits: 2, wordBits: 4, registers: 0 })
		).toThrow(CompileError);
		expect(() =>
			resolveComponentKind('registerFile', { addressBits: 2, wordBits: 4, registers: 99 })
		).toThrow(CompileError);
		expect(() => resolveComponentKind('rom', { contents: [0, 1, 2], wordBits: 4 })).toThrow(CompileError);
		expect(() => resolveComponentKind('rom', { contents: [0, 16], wordBits: 4 })).toThrow(CompileError);
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

	it('falls back to the static registry and leaves static kinds unchanged', () => {
		const andKind = resolveComponentKind('and')!;
		expect([...andKind.inputs]).toEqual([...primitiveKinds.and.inputs]);
		expect([...andKind.outputs]).toEqual([...primitiveKinds.and.outputs]);
		expect(resolveComponentKind('does-not-exist')).toBeNull();
		expect(pinoutForParameterizedKind('and')).toBeNull();

		const andPinout = resolveKind('and', 'logic')!;
		expect([...andPinout.inputs]).toEqual([...primitiveKinds.and.inputs]);
		expect([...andPinout.outputs]).toEqual([...primitiveKinds.and.outputs]);

		const ramPinout = resolveKind('ram', 'logic', { addressBits: 2, wordBits: 4 })!;
		expect([...ramPinout.inputs].filter((pin) => pin.startsWith('a')).length).toBe(2);
		expect([...ramPinout.outputs].length).toBe(4);
	});

	it('compiles every family with explicit and default parameters', () => {
		const explicit: Array<{ kind: string; params: Record<string, unknown> }> = [
			{ kind: 'rippleCarryAdder', params: { width: 4 } },
			{ kind: 'magnitudeComparator', params: { width: 4 } },
			{ kind: 'register', params: { width: 4 } },
			{ kind: 'counter', params: { width: 4 } },
			{ kind: 'shiftRegister', params: { width: 4 } },
			{ kind: 'registerFile', params: { addressBits: 2, wordBits: 4 } },
			{ kind: 'ram', params: { addressBits: 2, wordBits: 4 } },
			{ kind: 'rom', params: { contents: [1, 2, 3, 4], wordBits: 4 } }
		];
		const explicitComponents = explicit.map(({ kind, params }, index) => {
			const resolved = resolveComponentKind(kind, params)!;
			return { id: `c${index}`, kind, params, ...prefixedNets(`c${index}`, resolved) };
		});
		const explicitNetlist = compileWithResolver(document(explicitComponents), resolveComponentKind);
		expect(explicitNetlist.components.length).toBe(8);

		const defaultComponents = PARAMETERIZED_FAMILY_KINDS.map((kind, index) => {
			const resolved = resolveComponentKind(kind)!;
			return { id: `d${index}`, kind, ...prefixedNets(`d${index}`, resolved) };
		});
		const defaultNetlist = compileWithResolver(document(defaultComponents), resolveComponentKind);
		expect(defaultNetlist.components.length).toBe(8);
	});

	it('simulates arithmetic and memory families through the resolver', () => {
		const adderKind = resolveComponentKind('rippleCarryAdder', { width: 8 })!;
		const adderDoc = document([
			{
				id: 'adder',
				kind: 'rippleCarryAdder',
				params: { width: 8 },
				inputs: inputsFor(adderKind),
				outputs: outputsFor(adderKind)
			}
		]);
		const adderSim = new Simulator(adderDoc, resolveComponentKind);
		bitsOf(15, 8).forEach((bit, i) => adderSim.setNet(`a${i}`, bit));
		bitsOf(27, 8).forEach((bit, i) => adderSim.setNet(`b${i}`, bit));
		adderSim.setNet('cin', 1);
		expect(adderSim.settle().status).toBe('stable');
		expect(readBits(adderSim, 's', 8)).toEqual(bitsOf(15 + 27 + 1, 8));
		expect(adderSim.getNet('cout')).toBe(0);

		const cmpKind = resolveComponentKind('magnitudeComparator', { width: 4 })!;
		const cmpDoc = document([
			{
				id: 'cmp',
				kind: 'magnitudeComparator',
				params: { width: 4 },
				inputs: inputsFor(cmpKind),
				outputs: outputsFor(cmpKind)
			}
		]);
		const cmpSim = new Simulator(cmpDoc, resolveComponentKind);
		bitsOf(9, 4).forEach((bit, i) => cmpSim.setNet(`a${i}`, bit));
		bitsOf(6, 4).forEach((bit, i) => cmpSim.setNet(`b${i}`, bit));
		cmpSim.settle();
		expect(cmpSim.getNet('gt')).toBe(1);
		expect(cmpSim.getNet('lt')).toBe(0);
		expect(cmpSim.getNet('eq')).toBe(0);

		const romKind = resolveComponentKind('rom', { contents: [9, 6, 0, 0], wordBits: 4 })!;
		const romDoc = document([
			{
				id: 'rom',
				kind: 'rom',
				params: { contents: [9, 6, 0, 0], wordBits: 4 },
				inputs: inputsFor(romKind),
				outputs: outputsFor(romKind)
			}
		]);
		const romSim = new Simulator(romDoc, resolveComponentKind);
		romSim.setNet('a0', 0);
		romSim.setNet('a1', 0);
		romSim.settle();
		expect(readBits(romSim, 'd', 4)).toEqual(bitsOf(9, 4));

		const ramKind = resolveComponentKind('ram', { addressBits: 2, wordBits: 4 })!;
		const ramDoc = document([
			{
				id: 'ram',
				kind: 'ram',
				params: { addressBits: 2, wordBits: 4 },
				inputs: inputsFor(ramKind),
				outputs: outputsFor(ramKind)
			}
		]);
		const ramSim = new Simulator(ramDoc, resolveComponentKind);
		ramSim.setNet('clk', 0);
		ramSim.setNet('we', 0);
		ramSim.settle();
		bitsOf(2, 2).forEach((bit, i) => ramSim.setNet(`a${i}`, bit));
		bitsOf(0b1010, 4).forEach((bit, i) => ramSim.setNet(`d${i}`, bit));
		ramSim.setNet('we', 1);
		ramSim.setNet('clk', 0);
		ramSim.settle();
		ramSim.setNet('clk', 1);
		ramSim.settle();
		ramSim.setNet('we', 0);
		ramSim.settle();
		expect(readBits(ramSim, 'q', 4)).toEqual(bitsOf(0b1010, 4));
	});

	it('simulates counter and shift register through the resolver', () => {
		const counterKind = resolveComponentKind('counter', { width: 2 })!;
		const counterSim = new Simulator(
			document([
				{
					id: 'ctr',
					kind: 'counter',
					params: { width: 2 },
					inputs: inputsFor(counterKind),
					outputs: outputsFor(counterKind)
				}
			]),
			resolveComponentKind
		);
		counterSim.setNet('reset', 1);
		counterSim.setNet('enable', 1);
		counterSim.setNet('load', 0);
		clock(counterSim);
		expect(readBits(counterSim, 'q', 2)).toEqual(bitsOf(0, 2));
		counterSim.setNet('reset', 0);
		clock(counterSim);
		expect(readBits(counterSim, 'q', 2)).toEqual(bitsOf(1, 2));

		const shiftKind = resolveComponentKind('shiftRegister', { width: 4 })!;
		const shiftSim = new Simulator(
			document([
				{
					id: 'sr',
					kind: 'shiftRegister',
					params: { width: 4 },
					inputs: inputsFor(shiftKind),
					outputs: outputsFor(shiftKind)
				}
			]),
			resolveComponentKind
		);
		shiftSim.setNet('reset', 1);
		shiftSim.setNet('load', 0);
		shiftSim.setNet('sin', 0);
		clock(shiftSim);
		shiftSim.setNet('reset', 0);
		shiftSim.setNet('sin', 1);
		clock(shiftSim);
		expect(readBits(shiftSim, 'q', 4)).toEqual([1, 0, 0, 0]);
	});
});
