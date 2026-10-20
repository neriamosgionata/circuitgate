import { describe, expect, it } from 'vitest';
import { CompileError } from '../compile';
import { Simulator } from '../evaluate';
import { counterKind, shiftRegisterKind } from '../primitives/sequential';
import { bitsOf, clock, document, inputsFor, outputsFor, readBits } from './helpers';

function counterSim(width: number): Simulator {
	const kind = counterKind(width);
	return new Simulator(
		document([{ id: 'ctr', kind: 'counter', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
		{ counter: kind }
	);
}

function shiftSim(width: number): Simulator {
	const kind = shiftRegisterKind(width);
	return new Simulator(
		document([{ id: 'sr', kind: 'shiftRegister', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
		{ shiftRegister: kind }
	);
}

describe('counter primitives', () => {
	it('rejects widths outside 1..32', () => {
		for (const factory of [counterKind, shiftRegisterKind]) {
			expect(() => factory(0)).toThrow(CompileError);
			expect(() => factory(33)).toThrow(CompileError);
		}
	});

	it('exposes clock, reset, enable, load inputs and one output per bit', () => {
		const kind = counterKind(4);
		expect([...kind.inputs]).toEqual(['clk', 'reset', 'enable', 'load', 'd0', 'd1', 'd2', 'd3']);
		expect([...kind.outputs]).toEqual(['q0', 'q1', 'q2', 'q3']);
	});

	it('advances, wraps, and resets on a rising edge', () => {
		const sim = counterSim(2);
		sim.setNet('reset', 1);
		sim.setNet('enable', 1);
		sim.setNet('load', 0);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(0, 2));

		sim.setNet('reset', 0);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(1, 2));
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(2, 2));
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(3, 2));
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(0, 2));

		sim.setNet('reset', 1);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(0, 2));
	});

	it('holds the count while enable is low', () => {
		const sim = counterSim(4);
		sim.setNet('reset', 0);
		sim.setNet('enable', 1);
		sim.setNet('load', 1);
		bitsOf(0b0101, 4).forEach((bit, i) => sim.setNet(`d${i}`, bit));
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0b0101, 4));

		sim.setNet('load', 0);
		sim.setNet('enable', 0);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0b0101, 4));
	});

	it('loads parallel data with priority over enable', () => {
		const sim = counterSim(4);
		sim.setNet('reset', 0);
		sim.setNet('enable', 1);
		sim.setNet('load', 1);
		bitsOf(0b1010, 4).forEach((bit, i) => sim.setNet(`d${i}`, bit));
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0b1010, 4));
	});

	it('drives unknown on unknown control inputs', () => {
		const sim = counterSim(2);
		sim.setNet('reset', 'X');
		sim.setNet('enable', 1);
		sim.setNet('load', 0);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(['X', 'X']);
	});
});

describe('shift register primitives', () => {
	it('exposes clock, reset, load, serial-in, data, and output pins', () => {
		const kind = shiftRegisterKind(4);
		expect([...kind.inputs]).toEqual(['clk', 'reset', 'load', 'sin', 'd0', 'd1', 'd2', 'd3']);
		expect([...kind.outputs]).toEqual(['q0', 'q1', 'q2', 'q3']);
	});

	it('shifts serial input toward the most significant bit', () => {
		const sim = shiftSim(4);
		sim.setNet('reset', 0);
		sim.setNet('load', 0);
		sim.setNet('sin', 1);
		sim.setNet('reset', 1);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0, 4));

		sim.setNet('reset', 0);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual([1, 0, 0, 0]);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual([1, 1, 0, 0]);
		sim.setNet('sin', 0);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual([0, 1, 1, 0]);
	});

	it('propagates an unknown serial input through the word', () => {
		const sim = shiftSim(4);
		sim.setNet('reset', 1);
		sim.setNet('load', 0);
		sim.setNet('sin', 0);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0, 4));

		sim.setNet('reset', 0);
		sim.setNet('sin', 'X');
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(['X', 0, 0, 0]);

		sim.setNet('sin', 0);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual([0, 'X', 0, 0]);
	});

	it('parallel-loads and resets', () => {
		const sim = shiftSim(4);
		sim.setNet('reset', 0);
		sim.setNet('load', 1);
		bitsOf(0b1011, 4).forEach((bit, i) => sim.setNet(`d${i}`, bit));
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0b1011, 4));

		sim.setNet('load', 0);
		sim.setNet('reset', 1);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0, 4));
	});

	it('drives unknown on unknown control inputs', () => {
		const sim = shiftSim(4);
		sim.setNet('reset', 0);
		sim.setNet('load', 'X');
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(['X', 'X', 'X', 'X']);
	});
});
