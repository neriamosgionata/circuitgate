import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { CompileError } from '../compile';
import { Simulator } from '../evaluate';
import {
	DefinitionCycleError,
	SUB_CIRCUIT_KIND,
	createSubcircuitKind,
	flatten,
	type SubcircuitDefinition,
	type SubcircuitDefinitions
} from '../hierarchy';
import { primitiveKinds } from '../primitives';

function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

const halfAdderDefinition: SubcircuitDefinition = {
	name: 'halfAdder',
	inputs: { a: 'A', b: 'B' },
	outputs: { sum: 'SUM', carry: 'CARRY' },
	document: document([
		{ id: 'x', kind: 'xor', inputs: { a: 'A', b: 'B' }, outputs: { out: 'SUM' } },
		{ id: 'a', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'CARRY' } }
	])
};

const fullAdderDefinition: SubcircuitDefinition = {
	name: 'fullAdder',
	inputs: { a: 'A', b: 'B', cin: 'CIN' },
	outputs: { sum: 'SUM', cout: 'COUT' },
	document: document([
		{
			id: 'h1',
			kind: SUB_CIRCUIT_KIND,
			params: { definition: 'halfAdder' },
			inputs: { a: 'A', b: 'B' },
			outputs: { sum: 'P', carry: 'C1' }
		},
		{
			id: 'h2',
			kind: SUB_CIRCUIT_KIND,
			params: { definition: 'halfAdder' },
			inputs: { a: 'P', b: 'CIN' },
			outputs: { sum: 'SUM', carry: 'C2' }
		},
		{ id: 'o', kind: 'or', inputs: { a: 'C1', b: 'C2' }, outputs: { out: 'COUT' } }
	])
};

const definitions: SubcircuitDefinitions = {
	halfAdder: halfAdderDefinition,
	fullAdder: fullAdderDefinition
};

const topWithInstance = document([
	{
		id: 'fa',
		kind: SUB_CIRCUIT_KIND,
		params: { definition: 'fullAdder' },
		inputs: { a: 'A', b: 'B', cin: 'CIN' },
		outputs: { sum: 'SUM', cout: 'COUT' }
	}
]);

const handFlattened = document([
	{ id: 'fa/x1', kind: 'xor', inputs: { a: 'A', b: 'B' }, outputs: { out: 'P' } },
	{ id: 'fa/a1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'C1' } },
	{ id: 'fa/x2', kind: 'xor', inputs: { a: 'P', b: 'CIN' }, outputs: { out: 'SUM' } },
	{ id: 'fa/a2', kind: 'and', inputs: { a: 'P', b: 'CIN' }, outputs: { out: 'C2' } },
	{ id: 'fa/o', kind: 'or', inputs: { a: 'C1', b: 'C2' }, outputs: { out: 'COUT' } }
]);

describe('subcircuit flattening', () => {
	it('produces the same results as a hand-flattened build for nested definitions', () => {
		const flattened = flatten(topWithInstance, definitions, primitiveKinds);
		for (const a of [0, 1] as const) {
			for (const b of [0, 1] as const) {
				for (const cin of [0, 1] as const) {
					const hier = new Simulator(flattened, primitiveKinds);
					const flat = new Simulator(handFlattened, primitiveKinds);
					for (const sim of [hier, flat]) {
						sim.setNet('A', a);
						sim.setNet('B', b);
						sim.setNet('CIN', cin);
						expect(sim.settle().status).toBe('stable');
					}
					const total = a + b + cin;
					const label = `full adder ${a}+${b}+${cin}`;
					expect(hier.getNet('SUM'), label).toBe(total & 1);
					expect(hier.getNet('COUT'), label).toBe(total >> 1);
					expect(hier.getNet('SUM'), `${label} hierarchy vs flat`).toBe(flat.getNet('SUM'));
					expect(hier.getNet('COUT'), `${label} hierarchy vs flat`).toBe(flat.getNet('COUT'));
				}
			}
		}
	});

	it('namespaces instance ids and internal nets so instances do not collide', () => {
		const twoInstances = document([
			{
				id: 'fa1',
				kind: SUB_CIRCUIT_KIND,
				params: { definition: 'fullAdder' },
				inputs: { a: 'A', b: 'B', cin: 'CIN' },
				outputs: { sum: 'SUM', cout: 'COUT' }
			},
			{
				id: 'fa2',
				kind: SUB_CIRCUIT_KIND,
				params: { definition: 'fullAdder' },
				inputs: { a: 'SUM', b: 'B', cin: 'CIN' },
				outputs: { sum: 'SUM2', cout: 'COUT2' }
			},
			{ id: 'g', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'G' } }
		]);
		const flattened = flatten(twoInstances, definitions, primitiveKinds);
		const ids = flattened.components.map((component) => component.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain('fa1/h1/x');
		expect(ids).toContain('fa2/h2/a');
		const leaf = flattened.components.find((component) => component.id === 'g');
		expect(leaf?.inputs).toEqual({ a: 'A', b: 'B' });
	});

	it('rejects a self-referential definition with a structured cycle error', () => {
		const loop: SubcircuitDefinitions = {
			loop: {
				name: 'loop',
				inputs: { a: 'A' },
				outputs: { y: 'Y' },
				document: document([
					{
						id: 'inner',
						kind: SUB_CIRCUIT_KIND,
						params: { definition: 'loop' },
						inputs: { a: 'A' },
						outputs: { y: 'Y' }
					}
				])
			}
		};
		let caught: unknown;
		try {
			flatten(document([]), loop, primitiveKinds);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DefinitionCycleError);
		const cycleError = caught as DefinitionCycleError;
		expect(cycleError.code).toBe('hierarchy-cycle');
		expect(cycleError.cycle[0]).toBe('loop');
		expect(cycleError.cycle[cycleError.cycle.length - 1]).toBe('loop');
	});

	it('rejects mutually recursive definitions', () => {
		const a: SubcircuitDefinition = {
			name: 'a',
			inputs: { in: 'IN' },
			outputs: { out: 'OUT' },
			document: document([
				{
					id: 'b',
					kind: SUB_CIRCUIT_KIND,
					params: { definition: 'b' },
					inputs: { in: 'IN' },
					outputs: { out: 'OUT' }
				}
			])
		};
		const b: SubcircuitDefinition = {
			name: 'b',
			inputs: { in: 'IN' },
			outputs: { out: 'OUT' },
			document: document([
				{
					id: 'a',
					kind: SUB_CIRCUIT_KIND,
					params: { definition: 'a' },
					inputs: { in: 'IN' },
					outputs: { out: 'OUT' }
				}
			])
		};
		let caught: unknown;
		try {
			flatten(document([]), { a, b }, primitiveKinds);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DefinitionCycleError);
		const cycleError = caught as DefinitionCycleError;
		expect(cycleError.cycle.length).toBeGreaterThanOrEqual(3);
		expect(cycleError.cycle).toContain('a');
		expect(cycleError.cycle).toContain('b');
	});

	it('rejects unknown definitions and missing pins with structured errors', () => {
		const unknownDefinition = document([
			{
				id: 'bad',
				kind: SUB_CIRCUIT_KIND,
				params: { definition: 'missing' },
				inputs: {},
				outputs: {}
			}
		]);
		let caught: unknown;
		try {
			flatten(unknownDefinition, definitions, primitiveKinds);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(CompileError);
		expect((caught as CompileError).code).toBe('unknown-subcircuit');

		const missingPin = document([
			{
				id: 'bad',
				kind: SUB_CIRCUIT_KIND,
				params: { definition: 'halfAdder' },
				inputs: { a: 'A' },
				outputs: { sum: 'SUM', carry: 'CARRY' }
			}
		]);
		let pinCaught: unknown;
		try {
			flatten(missingPin, definitions, primitiveKinds);
		} catch (error) {
			pinCaught = error;
		}
		expect(pinCaught).toBeInstanceOf(CompileError);
		expect((pinCaught as CompileError).code).toBe('missing-subcircuit-pin');
	});

	it('describes subcircuit boundary pins and refuses direct evaluation', () => {
		const kind = createSubcircuitKind(halfAdderDefinition, primitiveKinds);
		expect(kind.inputs).toEqual(['a', 'b']);
		expect(kind.outputs).toEqual(['sum', 'carry']);
		let caught: unknown;
		try {
			kind.evaluate([0, 0], undefined);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(CompileError);
		expect((caught as CompileError).code).toBe('hierarchy-not-flattened');
	});
});
