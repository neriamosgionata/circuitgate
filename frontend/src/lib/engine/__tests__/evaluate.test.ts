import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import type { ComponentKind, ComponentKinds } from '../compile';
import { Simulator } from '../evaluate';
import { and, not, or, xor } from '../values';

const gate = (evaluator: (a: 0 | 1 | 'X' | 'Z', b: 0 | 1 | 'X' | 'Z') => 0 | 1 | 'X' | 'Z'): ComponentKind => ({
	inputs: ['a', 'b'],
	outputs: ['out'],
	evaluate: ([a, b]) => ({ outputs: [evaluator(a, b)] })
});

const kinds: ComponentKinds = {
	and: gate(and),
	or: gate(or),
	not: {
		inputs: ['a'],
		outputs: ['out'],
		evaluate: ([a]) => ({ outputs: [not(a)] })
	},
	xor: gate(xor)
};

function doc(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

function halfAdder(a: 0 | 1, b: 0 | 1): Simulator {
	const sim = new Simulator(
		doc([
			{ id: 'x', kind: 'xor', inputs: { a: 'A', b: 'B' }, outputs: { out: 'SUM' } },
			{ id: 'n', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'CARRY' } }
		]),
		kinds
	);
	sim.setNet('A', a);
	sim.setNet('B', b);
	return sim;
}

describe('delta-cycle evaluation', () => {
	it('evaluates AND/OR/XOR truth tables over 0/1', () => {
		for (const [kind, fn] of [
			['and', and],
			['or', or],
			['xor', xor]
		] as const) {
			for (const a of [0, 1] as const) {
				for (const b of [0, 1] as const) {
					const sim = new Simulator(
						doc([{ id: 'g', kind, inputs: { a: 'A', b: 'B' }, outputs: { out: 'OUT' } }]),
						kinds
					);
					sim.setNet('A', a);
					sim.setNet('B', b);
					sim.settle();
					expect(sim.getNet('OUT')).toBe(fn(a, b));
				}
			}
		}
	});

	it('propagates X through gates with dominance rules', () => {
		const sim = new Simulator(
			doc([
				{ id: 'g', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'AND' } },
				{ id: 'h', kind: 'or', inputs: { a: 'A', b: 'B' }, outputs: { out: 'OR' } }
			]),
			kinds
		);
		sim.setNet('A', 'X');
		sim.setNet('B', 0);
		sim.settle();
		expect(sim.getNet('AND')).toBe(0);
		expect(sim.getNet('OR')).toBe('X');
	});

	it('computes half-adder vectors', () => {
		for (const [a, b] of [
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1]
		] as const) {
			const sim = halfAdder(a, b);
			sim.settle();
			expect(sim.getNet('SUM')).toBe(a ^ b);
			expect(sim.getNet('CARRY')).toBe(a & b);
		}
	});

	it('computes full-adder vectors', () => {
		const fullAdder = doc([
			{ id: 'x1', kind: 'xor', inputs: { a: 'A', b: 'B' }, outputs: { out: 'P' } },
			{ id: 's', kind: 'xor', inputs: { a: 'P', b: 'CIN' }, outputs: { out: 'SUM' } },
			{ id: 'c1', kind: 'and', inputs: { a: 'P', b: 'CIN' }, outputs: { out: 'C1' } },
			{ id: 'c2', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'C2' } },
			{ id: 'co', kind: 'or', inputs: { a: 'C1', b: 'C2' }, outputs: { out: 'COUT' } }
		]);
		for (const a of [0, 1] as const) {
			for (const b of [0, 1] as const) {
				for (const cin of [0, 1] as const) {
					const sim = new Simulator(fullAdder, kinds);
					sim.setNet('A', a);
					sim.setNet('B', b);
					sim.setNet('CIN', cin);
					sim.settle();
					const total = a + b + cin;
					expect(sim.getNet('SUM')).toBe(total & 1);
					expect(sim.getNet('COUT')).toBe(total >> 1);
				}
			}
		}
	});

	it('is idempotent: a settled circuit does not change on re-settle', () => {
		const sim = halfAdder(1, 1);
		const first = sim.settle();
		const before = sim.getNet('SUM');
		const second = sim.settle();
		expect(first.status).toBe('stable');
		expect(second).toEqual({ status: 'stable', cycles: 0, oscillatingNets: [] });
		expect(sim.getNet('SUM')).toBe(before);
	});

	it('detects an oscillation when a combinational cycle exceeds the cap', () => {
		const sim = new Simulator(
			doc([{ id: 'inv', kind: 'not', inputs: { a: 'LOOP' }, outputs: { out: 'LOOP' } }]),
			kinds
		);
		sim.setNet('LOOP', 1);
		const result = sim.settle({ maxDeltaCycles: 10 });
		expect(result.status).toBe('oscillation');
		expect(result.oscillatingNets.length).toBeGreaterThan(0);
		expect(sim.getNet('LOOP')).toBe('X');
	});

	it('runs a ring oscillator in timed mode with unit delay', () => {
		const sim = new Simulator(
			doc([{ id: 'inv', kind: 'not', inputs: { a: 'LOOP' }, outputs: { out: 'LOOP' } }]),
			kinds
		);
		sim.setNet('LOOP', 1);
		const { snapshots } = sim.runTimed({ ticks: 6 });
		const netIndex = sim.netlist.netIndex.get('LOOP') as number;
		const series = snapshots.map((values) => values[netIndex]);
		expect(series.every((value) => value !== 'X')).toBe(true);
		for (let tick = 1; tick < series.length; tick++) {
			expect(series[tick]).toBe(series[tick - 1] === 0 ? 1 : 0);
		}
	});

	it('drives a self-scheduling clock in timed mode', () => {
		const kindsWithClock: ComponentKinds = {
			...kinds,
			clock: {
				inputs: [],
				outputs: ['out'],
				selfScheduling: true,
				evaluate: (_inputs, state) => {
					const next = state === 1 ? 0 : 1;
					return { outputs: [next], state: next };
				}
			}
		};
		const sim = new Simulator(
			doc([{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } }]),
			kindsWithClock
		);
		const { snapshots } = sim.runTimed({ ticks: 5 });
		const netIndex = sim.netlist.netIndex.get('CLK') as number;
		const series = snapshots.map((values) => values[netIndex]);
		expect(new Set(series).size).toBe(2);
	});
});
