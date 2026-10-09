import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import type { ComponentKinds } from '../compile';
import { Simulator } from '../evaluate';
import { primitiveKinds } from '../primitives';
import { magnitudeComparatorKind, rippleCarryAdderKind } from '../primitives/adders';
import { registerKind } from '../primitives/flipflops';
import { triStateBuffer } from '../primitives/gates';
import type { LogicValue } from '../values';

type V = LogicValue;

function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

function evaluateKind(kinds: ComponentKinds, kindName: string, values: readonly (V | undefined)[] = []): V[] {
	const kind = kinds[kindName];
	const inputs: Record<string, string> = {};
	kind.inputs.forEach((pin) => {
		inputs[pin] = `IN_${pin}`;
	});
	const outputs: Record<string, string> = {};
	kind.outputs.forEach((pin) => {
		outputs[pin] = `OUT_${pin}`;
	});
	const sim = new Simulator(document([{ id: 'g', kind: kindName, inputs, outputs }]), kinds);
	kind.inputs.forEach((pin, index) => {
		const value = values[index];
		if (value !== undefined) sim.setNet(`IN_${pin}`, value);
	});
	expect(sim.settle().status).toBe('stable');
	return kind.outputs.map((pin) => sim.getNet(`OUT_${pin}`) as V);
}

function bitsOf(value: bigint, width: number): (0 | 1)[] {
	const bits: (0 | 1)[] = [];
	for (let index = 0; index < width; index++) {
		bits.push(Number((value >> BigInt(index)) & 1n) as 0 | 1);
	}
	return bits;
}

describe('gate primitives', () => {
	it('matches AND/OR/XOR/NAND/NOR/XNOR/buffer truth tables over 0/1', () => {
		const expected: Record<string, (a: 0 | 1, b: 0 | 1) => 0 | 1> = {
			and: (a, b) => (a & b) as 0 | 1,
			or: (a, b) => (a | b) as 0 | 1,
			xor: (a, b) => (a ^ b) as 0 | 1,
			nand: (a, b) => ((a & b) ^ 1) as 0 | 1,
			nor: (a, b) => ((a | b) ^ 1) as 0 | 1,
			xnor: (a, b) => ((a ^ b) ^ 1) as 0 | 1,
			buffer: (a) => a
		};
		for (const [kindName, fn] of Object.entries(expected)) {
			for (const a of [0, 1] as const) {
				for (const b of [0, 1] as const) {
					expect(evaluateKind(primitiveKinds, kindName, [a, b]), `${kindName}(${a},${b})`).toEqual([fn(a, b)]);
				}
			}
		}
	});

	it('inverts with NOT and propagates unknown inputs', () => {
		expect(evaluateKind(primitiveKinds, 'not', [0])).toEqual([1]);
		expect(evaluateKind(primitiveKinds, 'not', [1])).toEqual([0]);
		expect(evaluateKind(primitiveKinds, 'not', ['X'])).toEqual(['X']);
	});

	it('propagates X and Z according to each gate semantics', () => {
		expect(evaluateKind(primitiveKinds, 'and', ['X', 0])).toEqual([0]);
		expect(evaluateKind(primitiveKinds, 'and', ['X', 1])).toEqual(['X']);
		expect(evaluateKind(primitiveKinds, 'and', ['Z', 0])).toEqual([0]);
		expect(evaluateKind(primitiveKinds, 'or', ['X', 1])).toEqual([1]);
		expect(evaluateKind(primitiveKinds, 'or', ['X', 0])).toEqual(['X']);
		expect(evaluateKind(primitiveKinds, 'xor', ['X', 1])).toEqual(['X']);
		expect(evaluateKind(primitiveKinds, 'xnor', ['X', 1])).toEqual(['X']);
		expect(evaluateKind(primitiveKinds, 'buffer', ['Z'])).toEqual(['Z']);
	});

	it('drives a switch and accepts probe/LED sinks', () => {
		const sim = new Simulator(
			document([
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'S' } },
				{ id: 'p', kind: 'probe', inputs: { in: 'S' }, outputs: {} },
				{ id: 'led', kind: 'led', inputs: { in: 'S' }, outputs: {} }
			]),
			primitiveKinds
		);
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('S')).toBe(0);
		sim.setState('sw', { value: 1 });
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('S')).toBe(1);
		sim.setState('sw', { value: 0 });
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('S')).toBe(0);
	});

	it('exposes the fixed primitive kinds in the ready-made registry', () => {
		for (const name of [
			'and',
			'or',
			'not',
			'nand',
			'nor',
			'xor',
			'xnor',
			'buffer',
			'switch',
			'probe',
			'led',
			'clock',
			'dFlipFlop',
			'jkFlipFlop',
			'srFlipFlop',
			'srLatch',
			'mux2',
			'mux4',
			'halfAdder',
			'fullAdder',
			'decoder2',
			'decoder3'
		]) {
			expect(primitiveKinds[name], name).toBeDefined();
		}
	});

	it('toggles the clock kind in timed mode', () => {
		const sim = new Simulator(
			document([{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } }]),
			primitiveKinds
		);
		const { snapshots } = sim.runTimed({ ticks: 4 });
		const netIndex = sim.netlist.netIndex.get('CLK') as number;
		const series = snapshots.map((values) => values[netIndex]);
		expect(series.every((value) => value === 0 || value === 1)).toBe(true);
		for (let tick = 1; tick < series.length; tick++) {
			expect(series[tick]).toBe(series[tick - 1] === 0 ? 1 : 0);
		}
	});
});

describe('flip-flops and registers', () => {
	it('latches D on a rising clock edge and holds otherwise', () => {
		const sim = new Simulator(
			document([
				{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
			]),
			primitiveKinds
		);
		sim.setNet('D', 1);
		sim.setNet('CLK', 0);
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('Q')).toBe('X');

		sim.setNet('CLK', 1);
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('Q')).toBe(1);
		expect(sim.getNet('QN')).toBe(0);

		sim.setNet('D', 0);
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('Q')).toBe(1);

		sim.setNet('CLK', 0);
		expect(sim.settle().status).toBe('stable');
		sim.setNet('CLK', 1);
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('Q')).toBe(0);
		expect(sim.getNet('QN')).toBe(1);
	});

	it('latches X when D is unknown at the rising edge', () => {
		const sim = new Simulator(
			document([
				{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
			]),
			primitiveKinds
		);
		sim.setNet('D', 1);
		sim.setNet('CLK', 0);
		sim.settle();
		sim.setNet('CLK', 1);
		sim.settle();
		expect(sim.getNet('Q')).toBe(1);

		sim.setNet('CLK', 0);
		sim.setNet('D', 'X');
		sim.settle();
		sim.setNet('CLK', 1);
		sim.settle();
		expect(sim.getNet('Q')).toBe('X');
		expect(sim.getNet('QN')).toBe('X');
	});

	it('implements JK hold/set/reset/toggle on rising edges', () => {
		const sim = new Simulator(
			document([
				{ id: 'ff', kind: 'jkFlipFlop', inputs: { j: 'J', k: 'K', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
			]),
			primitiveKinds
		);
		sim.setNet('J', 0);
		sim.setNet('K', 0);
		sim.setNet('CLK', 0);
		sim.settle();
		expect(sim.getNet('Q')).toBe('X');

		const edge = () => {
			sim.setNet('CLK', 0);
			sim.settle();
			sim.setNet('CLK', 1);
			sim.settle();
		};

		sim.setNet('J', 1);
		edge();
		expect(sim.getNet('Q')).toBe(1);

		sim.setNet('J', 0);
		edge();
		expect(sim.getNet('Q')).toBe(1);

		sim.setNet('K', 1);
		edge();
		expect(sim.getNet('Q')).toBe(0);

		sim.setNet('J', 1);
		edge();
		expect(sim.getNet('Q')).toBe(1);

		sim.setNet('J', 1);
		edge();
		expect(sim.getNet('Q')).toBe(0);

		sim.setNet('J', 0);
		sim.setNet('K', 0);
		edge();
		expect(sim.getNet('Q')).toBe(0);
	});

	it('implements the level-sensitive SR latch deterministically', () => {
		const sim = new Simulator(
			document([{ id: 'latch', kind: 'srLatch', inputs: { s: 'S', r: 'R' }, outputs: { q: 'Q', qn: 'QN' } }]),
			primitiveKinds
		);
		sim.setNet('S', 0);
		sim.setNet('R', 0);
		sim.settle();
		expect(sim.getNet('Q')).toBe('X');

		sim.setNet('S', 1);
		sim.settle();
		expect(sim.getNet('Q')).toBe(1);
		expect(sim.getNet('QN')).toBe(0);

		sim.setNet('S', 0);
		sim.settle();
		expect(sim.getNet('Q')).toBe(1);

		sim.setNet('R', 1);
		sim.settle();
		expect(sim.getNet('Q')).toBe(0);
		expect(sim.getNet('QN')).toBe(1);

		sim.setNet('S', 1);
		sim.settle();
		expect(sim.getNet('Q')).toBe(0);
		expect(sim.getNet('QN')).toBe(1);

		sim.setNet('S', 0);
		sim.setNet('R', 0);
		sim.settle();
		expect(sim.getNet('Q')).toBe(0);
	});

	it('latches a register word on the rising clock edge', () => {
		const sim = new Simulator(
			document([
				{
					id: 'reg',
					kind: 'register',
					inputs: { clk: 'CLK', d0: 'D0', d1: 'D1', d2: 'D2', d3: 'D3' },
					outputs: { q0: 'Q0', q1: 'Q1', q2: 'Q2', q3: 'Q3' }
				}
			]),
			{ register: registerKind(4) }
		);
		sim.setNet('CLK', 0);
		sim.setNet('D0', 0);
		sim.setNet('D1', 1);
		sim.setNet('D2', 0);
		sim.setNet('D3', 1);
		sim.settle();
		expect([sim.getNet('Q0'), sim.getNet('Q1'), sim.getNet('Q2'), sim.getNet('Q3')]).toEqual(['X', 'X', 'X', 'X']);

		sim.setNet('CLK', 1);
		sim.settle();
		expect([sim.getNet('Q0'), sim.getNet('Q1'), sim.getNet('Q2'), sim.getNet('Q3')]).toEqual([0, 1, 0, 1]);

		sim.setNet('D0', 1);
		sim.setNet('D3', 0);
		sim.settle();
		expect([sim.getNet('Q0'), sim.getNet('Q1'), sim.getNet('Q2'), sim.getNet('Q3')]).toEqual([0, 1, 0, 1]);

		sim.setNet('CLK', 0);
		sim.settle();
		sim.setNet('CLK', 1);
		sim.settle();
		expect([sim.getNet('Q0'), sim.getNet('Q1'), sim.getNet('Q2'), sim.getNet('Q3')]).toEqual([1, 1, 0, 0]);
	});

	it('latches a register on clock edges in timed mode', () => {
		const kinds: ComponentKinds = {
			clock: primitiveKinds['clock'],
			register: registerKind(1)
		};
		const sim = new Simulator(
			document([
				{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
				{ id: 'reg', kind: 'register', inputs: { clk: 'CLK', d0: 'D0' }, outputs: { q0: 'Q0' } }
			]),
			kinds
		);
		sim.setNet('D0', 1);
		const { snapshots } = sim.runTimed({ ticks: 6 });
		const qIndex = sim.netlist.netIndex.get('Q0') as number;
		const series = snapshots.map((values) => values[qIndex]);
		expect(series.slice(0, 3)).toEqual(['X', 'X', 'X']);
		expect(series.slice(3)).toEqual([1, 1, 1]);
	});
});

describe('multiplexers and decoders', () => {
	it('matches the 2:1 mux truth table', () => {
		for (const d0 of [0, 1] as const) {
			for (const d1 of [0, 1] as const) {
				for (const sel of [0, 1] as const) {
					const expected = sel === 0 ? d0 : d1;
					expect(evaluateKind(primitiveKinds, 'mux2', [d0, d1, sel]), `mux2(${d0},${d1},${sel})`).toEqual([expected]);
				}
			}
		}
		expect(evaluateKind(primitiveKinds, 'mux2', [0, 1, 'X'])).toEqual(['X']);
	});

	it('matches the 4:1 mux truth table', () => {
		const data = [0, 1, 1, 0] as const;
		for (const sel of [0, 1, 2, 3] as const) {
			const sel0 = (sel & 1) as 0 | 1;
			const sel1 = ((sel >> 1) & 1) as 0 | 1;
			expect(evaluateKind(primitiveKinds, 'mux4', [...data, sel0, sel1]), `mux4 sel=${sel}`).toEqual([data[sel]]);
		}
		expect(evaluateKind(primitiveKinds, 'mux4', [0, 1, 0, 1, 'X', 0])).toEqual(['X']);
	});

	it('decodes every 2-bit address one-hot', () => {
		for (const address of [0, 1, 2, 3] as const) {
			const bits = bitsOf(BigInt(address), 2);
			const outputs = evaluateKind(primitiveKinds, 'decoder2', bits);
			expect(outputs, `decoder2 address=${address}`).toEqual([0, 1, 2, 3].map((index) => (index === address ? 1 : 0)));
		}
		expect(evaluateKind(primitiveKinds, 'decoder2', ['X', 0])).toEqual(['X', 'X', 'X', 'X']);
	});
});

describe('tri-state buffer', () => {
	it('passes input through when enabled and floats when disabled', () => {
		expect(triStateBuffer.inputs).toEqual(['in', 'enable']);
		expect(triStateBuffer.outputs).toEqual(['out']);
		expect(evaluateKind(primitiveKinds, 'triStateBuffer', [0, 1])).toEqual([0]);
		expect(evaluateKind(primitiveKinds, 'triStateBuffer', [1, 1])).toEqual([1]);
		expect(evaluateKind(primitiveKinds, 'triStateBuffer', [1, 0])).toEqual(['Z']);
		expect(evaluateKind(primitiveKinds, 'triStateBuffer', ['X', 1])).toEqual(['X']);
		expect(evaluateKind(primitiveKinds, 'triStateBuffer', [1, 'X'])).toEqual(['X']);
	});

	it('leaves a driven net undisturbed while disabled and contends only when enabled', () => {
		const sim = new Simulator(
			document([
				{
					id: 'a',
					kind: 'triStateBuffer',
					inputs: { in: 'A', enable: 'ENA' },
					outputs: { out: 'BUS' }
				},
				{
					id: 'b',
					kind: 'triStateBuffer',
					inputs: { in: 'B', enable: 'ENB' },
					outputs: { out: 'BUS' }
				}
			]),
			{ triStateBuffer }
		);
		sim.setNet('A', 1);
		sim.setNet('B', 0);
		sim.setNet('ENA', 1);
		sim.setNet('ENB', 0);
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('BUS')).toBe(1);
		sim.setNet('ENB', 1);
		sim.settle();
		expect(sim.getNet('BUS')).toBe('X');
		sim.setNet('ENA', 0);
		sim.setNet('ENB', 0);
		sim.settle();
		expect(sim.getNet('BUS')).toBe('Z');
	});
});

describe('adders and comparators', () => {
	it('computes half-adder vectors', () => {
		for (const a of [0, 1] as const) {
			for (const b of [0, 1] as const) {
				expect(evaluateKind(primitiveKinds, 'halfAdder', [a, b]), `halfAdder(${a},${b})`).toEqual([a ^ b, a & b]);
			}
		}
	});

	it('computes full-adder vectors', () => {
		for (const a of [0, 1] as const) {
			for (const b of [0, 1] as const) {
				for (const cin of [0, 1] as const) {
					const total = a + b + cin;
					expect(evaluateKind(primitiveKinds, 'fullAdder', [a, b, cin]), `fullAdder(${a},${b},${cin})`).toEqual([
						total & 1,
						total >> 1
					]);
				}
			}
		}
	});

	it('computes every 4-bit ripple-carry addition with carry in', () => {
		const kinds: ComponentKinds = { ripple4: rippleCarryAdderKind(4) };
		for (let a = 0; a < 16; a++) {
			for (let b = 0; b < 16; b++) {
				for (const cin of [0, 1] as const) {
					const total = BigInt(a + b + cin);
					const outputs = evaluateKind(kinds, 'ripple4', [...bitsOf(BigInt(a), 4), ...bitsOf(BigInt(b), 4), cin]);
					const sum = outputs.slice(0, 4).reduce<bigint>((acc, bit, index) => acc | (BigInt(bit) << BigInt(index)), 0n);
					expect(sum, `4-bit ${a}+${b}+${cin}`).toBe(total & 0xfn);
					expect(outputs[4], `4-bit carry ${a}+${b}+${cin}`).toBe(Number((total >> 4n) & 1n));
				}
			}
		}
	});

	it('computes 8-bit operation vectors including carry chains', () => {
		const kinds: ComponentKinds = { ripple8: rippleCarryAdderKind(8) };
		const vectors: [number, number][] = [
			[0x00, 0x00],
			[0x7f, 0x01],
			[0xff, 0x01],
			[0xaa, 0x55]
		];
		for (const [a, b] of vectors) {
			const outputs = evaluateKind(kinds, 'ripple8', [...bitsOf(BigInt(a), 8), ...bitsOf(BigInt(b), 8), 0]);
			const sum = outputs.slice(0, 8).reduce<bigint>((acc, bit, index) => acc | (BigInt(bit) << BigInt(index)), 0n);
			expect(sum, `8-bit ${a}+${b}`).toBe(BigInt(a + b) & 0xffn);
			expect(outputs[8], `8-bit carry ${a}+${b}`).toBe((a + b) >> 8);
		}
	});

	it('computes 64-bit additions through chained full adders', () => {
		const kinds: ComponentKinds = { ripple64: rippleCarryAdderKind(64) };
		const vectors: [bigint, bigint][] = [
			[0n, 0n],
			[0xffffffffffffffffn, 1n],
			[0x0123456789abcdefn, 0xfedcba9876543210n]
		];
		for (const [a, b] of vectors) {
			const outputs = evaluateKind(kinds, 'ripple64', [...bitsOf(a, 64), ...bitsOf(b, 64), 0]);
			const sum = outputs.slice(0, 64).reduce<bigint>((acc, bit, index) => acc | (BigInt(bit) << BigInt(index)), 0n);
			expect(sum, `64-bit ${a.toString(16)}+${b.toString(16)}`).toBe((a + b) & 0xffffffffffffffffn);
			expect(outputs[64], `64-bit carry`).toBe(Number((a + b) >> 64n));
		}
	});

	it('compares 64-bit magnitudes', () => {
		const kinds: ComponentKinds = { compare64: magnitudeComparatorKind(64) };
		const vectors: [bigint, bigint][] = [
			[0n, 0n],
			[1n, 0n],
			[0n, 1n],
			[0xffffffffffffffffn, 0x0fffffffffffffffn],
			[0x0123456789abcdefn, 0x0123456789abcdfen]
		];
		for (const [a, b] of vectors) {
			const [eq, gt, lt] = evaluateKind(kinds, 'compare64', [...bitsOf(a, 64), ...bitsOf(b, 64)]);
			const label = `${a.toString(16)} vs ${b.toString(16)}`;
			expect(eq, `eq ${label}`).toBe(a === b ? 1 : 0);
			expect(gt, `gt ${label}`).toBe(a > b ? 1 : 0);
			expect(lt, `lt ${label}`).toBe(a < b ? 1 : 0);
		}
	});
});
