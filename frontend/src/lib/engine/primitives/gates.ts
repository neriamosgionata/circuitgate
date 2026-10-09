import type { ComponentKind } from '../compile';
import { and, not, or, xor, type LogicValue } from '../values';

function binaryGate(evaluate: (a: LogicValue, b: LogicValue) => LogicValue): ComponentKind {
	return {
		inputs: ['a', 'b'],
		outputs: ['out'],
		evaluate: ([a, b]) => ({ outputs: [evaluate(a, b)] })
	};
}

function unaryGate(evaluate: (a: LogicValue) => LogicValue): ComponentKind {
	return {
		inputs: ['a'],
		outputs: ['out'],
		evaluate: ([a]) => ({ outputs: [evaluate(a)] })
	};
}

export const andKind = binaryGate(and);
export const orKind = binaryGate(or);
export const xorKind = binaryGate(xor);
export const nandKind = binaryGate((a, b) => not(and(a, b)));
export const norKind = binaryGate((a, b) => not(or(a, b)));
export const xnorKind = binaryGate((a, b) => not(xor(a, b)));
export const notKind = unaryGate(not);
export const bufferKind = unaryGate((a) => a);

// Tri-state buffer. Enabled output follows the input (unknown passes through);
// disabled output floats high-impedance so wired multi-driver resolution
// ignores it. A non-binary enable drives unknown. Contention between enabled
// drivers is resolved by the engine, not here.
export const triStateBuffer: ComponentKind = {
	inputs: ['in', 'enable'],
	outputs: ['out'],
	evaluate: ([data, enable]) => {
		if (enable === 1) return { outputs: [data] };
		if (enable === 0) return { outputs: ['Z' as LogicValue] };
		return { outputs: ['X' as LogicValue] };
	}
};

export interface SwitchState {
	value: LogicValue;
}

export const switchKind: ComponentKind = {
	inputs: [],
	outputs: ['out'],
	evaluate: (_inputs, state) => {
		const value = (state as SwitchState | undefined)?.value ?? 0;
		return { outputs: [value], state: { value } };
	}
};

export const probeKind: ComponentKind = {
	inputs: ['in'],
	outputs: [],
	evaluate: () => ({ outputs: [] })
};

export const ledKind: ComponentKind = {
	inputs: ['in'],
	outputs: [],
	evaluate: () => ({ outputs: [] })
};

// A free-running half-period clock. It is meaningful in timed mode, where the
// engine re-queues self-scheduling kinds every unit delay. Calling settle() on a
// delta-cycle containing this kind deliberately oscillates into the cap.
export const clockKind: ComponentKind = {
	inputs: [],
	outputs: ['out'],
	selfScheduling: true,
	evaluate: (_inputs, state) => {
		const current = (state as { value?: LogicValue } | undefined)?.value;
		const next: LogicValue = current === 1 ? 0 : 1;
		return { outputs: [next], state: { value: next } };
	}
};
