import type { CircuitDocument, Component } from '../model/circuit';
import { CompileError, type ComponentKind, type ComponentKinds, type KindResolver } from './compile';

export const SUB_CIRCUIT_KIND = 'subcircuit';

export interface SubcircuitDefinition {
	name: string;
	inputs: Readonly<Record<string, string>>;
	outputs: Readonly<Record<string, string>>;
	document: CircuitDocument;
}

export type SubcircuitDefinitions = Readonly<Record<string, SubcircuitDefinition>>;

export class DefinitionCycleError extends CompileError {
	readonly cycle: readonly string[];

	constructor(cycle: readonly string[]) {
		super(`subcircuit definition cycle: ${cycle.join(' -> ')}`, 'hierarchy-cycle');
		this.name = 'DefinitionCycleError';
		this.cycle = [...cycle];
	}
}

function validateDefinitionShape(name: string, definition: SubcircuitDefinition): void {
	if (typeof definition.name !== 'string' || definition.name.length === 0) {
		throw new CompileError(`subcircuit definition ${name} has no name`, 'invalid-subcircuit-definition');
	}
	if (Object.keys(definition.inputs).length + Object.keys(definition.outputs).length === 0) {
		throw new CompileError(`subcircuit ${definition.name} has no boundary pins`, 'invalid-subcircuit-definition');
	}
}

function instanceDefinitionName(component: Component): string {
	const name = component.params?.['definition'];
	if (typeof name !== 'string' || name.length === 0) {
		throw new CompileError(
			`subcircuit instance ${component.id} is missing params.definition`,
			'invalid-subcircuit-instance'
		);
	}
	return name;
}

// Rejects self-referential and mutually recursive definitions before any
// expansion, so flattening always terminates.
export function detectDefinitionCycles(definitions: SubcircuitDefinitions): void {
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];

	const visit = (name: string): void => {
		const current = state.get(name);
		if (current === 'done') return;
		if (current === 'visiting') {
			throw new DefinitionCycleError([...stack.slice(stack.indexOf(name)), name]);
		}
		const definition = definitions[name];
		if (!definition) {
			throw new CompileError(`unknown subcircuit definition: ${name}`, 'unknown-subcircuit');
		}
		validateDefinitionShape(name, definition);
		state.set(name, 'visiting');
		stack.push(name);
		for (const component of definition.document.components) {
			if (component.kind !== SUB_CIRCUIT_KIND) continue;
			visit(instanceDefinitionName(component));
		}
		stack.pop();
		state.set(name, 'done');
	};

	for (const name of Object.keys(definitions)) visit(name);
}

function validateLeafKinds(definition: SubcircuitDefinition, kinds: ComponentKinds | KindResolver): void {
	for (const component of definition.document.components) {
		if (component.kind === SUB_CIRCUIT_KIND) continue;
		// Resolve each component from its own kind and parameters
		// at use time. A resolver function throws on invalid parameterized
		// params (surfacing bad widths/contents inside definitions); a static
		// map falls back to an existence check.
		const resolved =
			typeof kinds === 'function'
				? kinds(component.kind, component.params)
				: (kinds[component.kind] ?? null);
		if (!resolved) {
			throw new CompileError(
				`subcircuit ${definition.name} references unknown component kind: ${component.kind}`,
				'unknown-kind'
			);
		}
	}
}

function resolveNet(net: string, prefix: string, alias: ReadonlyMap<string, string> | null): string {
	const mapped = alias?.get(net);
	return mapped !== undefined ? mapped : `${prefix}${net}`;
}

function cloneLeaf(component: Component, id: string, prefix: string, alias: ReadonlyMap<string, string> | null): Component {
	const inputs: Record<string, string> = {};
	for (const [pin, net] of Object.entries(component.inputs)) inputs[pin] = resolveNet(net, prefix, alias);
	const outputs: Record<string, string> = {};
	for (const [pin, net] of Object.entries(component.outputs)) outputs[pin] = resolveNet(net, prefix, alias);
	const cloned: Component = { id, kind: component.kind, inputs, outputs };
	if (component.params !== undefined) cloned.params = component.params;
	if (component.initialState !== undefined) cloned.initialState = component.initialState;
	return cloned;
}

function expandInto(
	document: CircuitDocument,
	prefix: string,
	alias: ReadonlyMap<string, string> | null,
	definitions: SubcircuitDefinitions,
	out: Component[]
): void {
	for (const component of document.components) {
		const id = `${prefix}${component.id}`;
		if (component.kind !== SUB_CIRCUIT_KIND) {
			out.push(cloneLeaf(component, id, prefix, alias));
			continue;
		}
		const name = instanceDefinitionName(component);
		const definition = definitions[name];
		if (!definition) {
			throw new CompileError(`unknown subcircuit definition: ${name}`, 'unknown-subcircuit');
		}
		const childPrefix = `${id}/`;
		const childAlias = new Map<string, string>();
		for (const [pin, innerNet] of Object.entries(definition.inputs)) {
			const outerNet = component.inputs[pin];
			if (outerNet === undefined) {
				throw new CompileError(`subcircuit instance ${id} is missing input pin ${pin}`, 'missing-subcircuit-pin');
			}
			childAlias.set(innerNet, resolveNet(outerNet, prefix, alias));
		}
		for (const [pin, innerNet] of Object.entries(definition.outputs)) {
			const outerNet = component.outputs[pin];
			if (outerNet === undefined) {
				throw new CompileError(`subcircuit instance ${id} is missing output pin ${pin}`, 'missing-subcircuit-pin');
			}
			childAlias.set(innerNet, resolveNet(outerNet, prefix, alias));
		}
		expandInto(definition.document, childPrefix, childAlias, definitions, out);
	}
}

// Inlines every subcircuit instance into a flat document whose components are
// leaf kinds only. Internal nets of an instance are namespaced by instance id
// and boundary nets are aliased to the caller's nets, so a flattened build has
// exactly the timing semantics of the equivalent hand-drawn circuit.
export function flatten(
	document: CircuitDocument,
	definitions: SubcircuitDefinitions,
	kinds?: ComponentKinds | KindResolver
): CircuitDocument {
	detectDefinitionCycles(definitions);
	if (kinds) {
		for (const definition of Object.values(definitions)) validateLeafKinds(definition, kinds);
	}
	const components: Component[] = [];
	expandInto(document, '', null, definitions, components);
	return { schemaVersion: 1, components };
}

// Boundary-only kind description for a subcircuit. It lets editors and palettes
// treat a definition like any other kind; evaluation is only valid after
// flatten() has replaced instances with their leaf expansion.
export function createSubcircuitKind(definition: SubcircuitDefinition, kinds: ComponentKinds | KindResolver): ComponentKind {
	validateDefinitionShape(definition.name, definition);
	validateLeafKinds(definition, kinds);
	return {
		inputs: Object.keys(definition.inputs),
		outputs: Object.keys(definition.outputs),
		evaluate: () => {
			throw new CompileError(
				`subcircuit ${definition.name} must be flattened before simulation`,
				'hierarchy-not-flattened'
			);
		}
	};
}
