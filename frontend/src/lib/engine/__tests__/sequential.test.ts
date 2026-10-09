import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { CompileError } from '../compile';
import { Simulator } from '../evaluate';
import { counterKind, shiftRegisterKind } from '../primitives/sequential';
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

function clock(sim: Simulator): void {
	sim.setNet('clk', 0);
	sim.settle();
	sim.setNet('clk', 1);
	sim.settle();
}

describe('counter primitives', () => {
	it('rejects non-positive and oversized widths', () => {
		expect(() => counterKind(0)).toThrow(CompileError);
		expect(() => counterKind(33)).toThrow(CompileError);
	});

	it('exposes clock, reset, enable, load inputs and one output per bit', () => {
		const kind = counterKind(4);
		expect([...kind.inputs]).toEqual(['clk', 'reset', 'enable', 'load', 'd0', 'd1', 'd2', 'd3']);
		expect([...kind.outputs]).toEqual(['q0', 'q1', 'q2', 'q3']);
	});

	it('advances, wraps, resets, and holds on disabled enable', () => {
		const kind = counterKind(2);
		const sim = new Simulator(
			document([{ id: 'ctr', kind: 'counter', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ counter: kind }
		);
		sim.setNet('reset', 0);
		sim.setNet('enable', 1);
		sim.setNet('load', 0);
		for (const bit of ['d0', 'd1']) sim.setNet(bit, 0);
		sim.setNet('reset', 1);
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
		sim.setNet('enable', 0);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(0, 2));
		sim.setNet('enable', 1);
		sim.setNet('reset', 1);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(bitsOf(0, 2));
	});

	it('loads parallel data when load is asserted', () => {
		const kind = counterKind(4);
		const sim = new Simulator(
			document([{ id: 'ctr', kind: 'counter', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ counter: kind }
		);
		sim.setNet('reset', 0);
		sim.setNet('enable', 1);
		sim.setNet('load', 1);
		for (const [pin, value] of [['d0', 1], ['d1', 0], ['d2', 1], ['d3', 0]] as const) {
			sim.setNet(pin, value);
		}
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0b0101, 4));
	});

	it('drives unknown on unknown control inputs', () => {
		const kind = counterKind(2);
		const sim = new Simulator(
			document([{ id: 'ctr', kind: 'counter', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ counter: kind }
		);
		sim.setNet('reset', 'X');
		sim.setNet('enable', 1);
		sim.setNet('load', 0);
		clock(sim);
		expect(readBits(sim, 'q', 2)).toEqual(['X', 'X']);
	});
});

describe('shift register primitives', () => {
	it('rejects non-positive and oversized widths', () => {
		expect(() => shiftRegisterKind(0)).toThrow(CompileError);
		expect(() => shiftRegisterKind(33)).toThrow(CompileError);
	});

	it('exposes clock, reset, load, serial-in, data, and output pins', () => {
		const kind = shiftRegisterKind(4);
		expect([...kind.inputs]).toEqual(['clk', 'reset', 'load', 'sin', 'd0', 'd1', 'd2', 'd3']);
		expect([...kind.outputs]).toEqual(['q0', 'q1', 'q2', 'q3']);
	});

	it('shifts serial input toward the most significant bit', () => {
		const kind = shiftRegisterKind(4);
		const sim = new Simulator(
			document([{ id: 'sr', kind: 'shiftRegister', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ shiftRegister: kind }
		);
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

	it('parallel-loads and resets', () => {
		const kind = shiftRegisterKind(4);
		const sim = new Simulator(
			document([{ id: 'sr', kind: 'shiftRegister', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ shiftRegister: kind }
		);
		sim.setNet('reset', 0);
		sim.setNet('load', 1);
		for (const [pin, value] of [['d0', 1], ['d1', 1], ['d2', 0], ['d3', 1]] as const) {
			sim.setNet(pin, value);
		}
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0b1011, 4));
		sim.setNet('load', 0);
		sim.setNet('reset', 1);
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(bitsOf(0, 4));
	});

	it('drives unknown on unknown control inputs', () => {
		const kind = shiftRegisterKind(4);
		const sim = new Simulator(
			document([{ id: 'sr', kind: 'shiftRegister', inputs: inputsFor(kind), outputs: outputsFor(kind) }]),
			{ shiftRegister: kind }
		);
		sim.setNet('reset', 0);
		sim.setNet('load', 'X');
		clock(sim);
		expect(readBits(sim, 'q', 4)).toEqual(['X', 'X', 'X', 'X']);
	});
});
