import type { CircuitDocument } from '../model/circuit';
import type { LogicValue } from './values';

export interface ComponentEvaluation {
	outputs: readonly LogicValue[];
	state?: unknown;
}

export interface ComponentKind {
	inputs: readonly string[];
	outputs: readonly string[];
	selfScheduling?: boolean;
	evaluate(inputs: readonly LogicValue[], state: unknown): ComponentEvaluation;
}

export type ComponentKinds = Readonly<Record<string, ComponentKind>>;

/**
 * Per-component kind resolution: resolve one component from its own
 * kind and parameters at use time. Returns null for unknown kinds; throws
 * CompileError for known kinds with invalid parameters.
 */
export type KindResolver = (kind: string, params?: Record<string, unknown>) => ComponentKind | null;

export class CompileError extends Error {
	readonly code: string | undefined;

	constructor(message: string, code?: string) {
		super(message);
		this.name = 'CompileError';
		this.code = code;
	}
}

export interface CompiledComponent {
	index: number;
	id: string;
	kind: ComponentKind;
	selfScheduling: boolean;
	inputNets: number[];
	outputNets: number[];
	state: unknown;
}

export interface CompiledNetlist {
	netIds: string[];
	netIndex: Map<string, number>;
	components: CompiledComponent[];
	dependents: number[][];
}

export function compile(document: CircuitDocument, kinds: ComponentKinds): CompiledNetlist {
	return compileWithResolver(document, (kind) => kinds[kind] ?? null);
}

/**
 * Compile with per-component resolution: each component resolves from its own
 * kind and parameters, so two components sharing one kind string with
 * different params each compile against their own pinout. A per-kind table
 * cannot express that and must not be used for parameterized documents.
 */
export function compileWithResolver(document: CircuitDocument, resolve: KindResolver): CompiledNetlist {
	const netIds: string[] = [];
	const netIndex = new Map<string, number>();
	const componentIds = new Set<string>();

	const net = (name: string): number => {
		const existing = netIndex.get(name);
		if (existing !== undefined) return existing;
		const created = netIds.length;
		netIds.push(name);
		netIndex.set(name, created);
		return created;
	};

	const components: CompiledComponent[] = document.components.map((component, index) => {
		if (componentIds.has(component.id)) {
			throw new CompileError(`duplicate component id: ${component.id}`);
		}
		componentIds.add(component.id);

		const kind = resolve(component.kind, component.params);
		if (!kind) {
			throw new CompileError(`unknown component kind: ${component.kind}`);
		}

		const inputNets = kind.inputs.map((pin) => {
			const connected = component.inputs[pin];
			if (connected === undefined) {
				throw new CompileError(`component ${component.id} is missing input pin ${pin}`);
			}
			return net(connected);
		});

		const outputNets = kind.outputs.map((pin) => {
			const connected = component.outputs[pin];
			if (connected === undefined) {
				throw new CompileError(`component ${component.id} is missing output pin ${pin}`);
			}
			return net(connected);
		});

		return {
			index,
			id: component.id,
			kind,
			selfScheduling: kind.selfScheduling === true,
			inputNets,
			outputNets,
			state: component.initialState
		};
	});

	const dependents: number[][] = Array.from({ length: netIds.length }, () => []);
	for (const component of components) {
		for (const inputNet of component.inputNets) {
			dependents[inputNet].push(component.index);
		}
	}

	return { netIds, netIndex, components, dependents };
}
