import type { CircuitDocument } from '../../model/circuit';
import type { Simulator } from '../evaluate';
import type { LogicValue } from '../values';

export type V = LogicValue;

export interface KindPins {
	readonly inputs: readonly string[];
	readonly outputs: readonly string[];
}

export function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

export function inputsFor(kind: KindPins): Record<string, string> {
	const inputs: Record<string, string> = {};
	for (const pin of kind.inputs) inputs[pin] = pin;
	return inputs;
}

export function outputsFor(kind: KindPins): Record<string, string> {
	const outputs: Record<string, string> = {};
	for (const pin of kind.outputs) outputs[pin] = pin;
	return outputs;
}

export function prefixedNets(
	id: string,
	kind: KindPins
): { inputs: Record<string, string>; outputs: Record<string, string> } {
	const inputs: Record<string, string> = {};
	for (const pin of kind.inputs) inputs[pin] = `${id}_${pin}`;
	const outputs: Record<string, string> = {};
	for (const pin of kind.outputs) outputs[pin] = `${id}_${pin}`;
	return { inputs, outputs };
}

export function bitsOf(value: number, width: number): V[] {
	const bits: V[] = [];
	for (let index = 0; index < width; index++) {
		bits.push((Math.floor(value / 2 ** index) % 2) as V);
	}
	return bits;
}

export function readBits(sim: Simulator, prefix: string, width: number): V[] {
	const bits: V[] = [];
	for (let index = 0; index < width; index++) bits.push(sim.getNet(`${prefix}${index}`) as V);
	return bits;
}

export function clock(sim: Simulator, net = 'clk'): void {
	sim.setNet(net, 0);
	sim.settle();
	sim.setNet(net, 1);
	sim.settle();
}
