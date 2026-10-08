import { describe, expect, it } from 'vitest';
import { Simulator } from '../../engine/evaluate';
import { primitiveKinds } from '../../engine/primitives';
import { flatten } from '../../engine/hierarchy';
import type { CircuitDocument, Component } from '../../model/circuit';
import { snapPoint, worldToScreen, type LayoutMap, type Viewport } from '../../render/geometry';
import { buildScene } from '../../render/scene';
import { CircuitEditorStore, type Result } from '../circuitStore';

function expectOk<T>(result: Result<T>): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.error);
	return result.value;
}

function doc(components: Component[]): CircuitDocument {
	return { schemaVersion: 1, components };
}

describe('editor wiring', () => {
	it('snaps placed components to the grid at multiple zoom levels', () => {
		const store = new CircuitEditorStore();
		const viewports: Viewport[] = [
			{ scale: 1, offset: { x: 0, y: 0 } },
			{ scale: 0.5, offset: { x: 240, y: -120 } },
			{ scale: 3, offset: { x: -57, y: 8 } }
		];
		for (const viewport of viewports) {
			const screen = worldToScreen(viewport, { x: 57, y: 63 });
			const placed = expectOk(store.placeComponentAtScreen('and', screen, viewport));
			expect(store.snapshot.layout[placed.id].position).toEqual({ x: 60, y: 60 });
		}
	});

	it('connects two pins, rejects a self-connection, and rejects a dangling drop', () => {
		const store = new CircuitEditorStore();
		const source = expectOk(store.placeComponent('switch', { x: 0, y: 0 }));
		const sink = expectOk(store.placeComponent('probe', { x: 200, y: 0 }));
		const sourcePin = { componentId: source.id, pin: 'out', side: 'output' as const };
		const sinkPin = { componentId: sink.id, pin: 'in', side: 'input' as const };

		expect(store.beginWire(sourcePin).ok).toBe(true);
		const net = expectOk(store.completeWire(sinkPin));
		const wired = store.snapshot.document.components;
		expect(wired.find((component) => component.id === source.id)?.outputs.out).toBe(net);
		expect(wired.find((component) => component.id === sink.id)?.inputs.in).toBe(net);

		expect(store.beginWire(sourcePin).ok).toBe(true);
		const self = store.completeWire(sourcePin);
		expect(self).toEqual({ ok: false, error: 'self-connection' });
		expect(store.snapshot.pendingWire).toEqual(sourcePin);
		store.cancelWire();
		expect(store.snapshot.pendingWire).toBeNull();

		const netCountBefore = store.snapshot.document.components.reduce(
			(total, component) =>
				total + Object.keys(component.inputs).length + Object.keys(component.outputs).length,
			0
		);
		expect(store.beginWire(sourcePin).ok).toBe(true);
		expect(store.endWire(null)).toEqual({ ok: false, error: 'dangling-wire' });
		expect(store.snapshot.pendingWire).toBeNull();
		const netCountAfter = store.snapshot.document.components.reduce(
			(total, component) =>
				total + Object.keys(component.inputs).length + Object.keys(component.outputs).length,
			0
		);
		expect(netCountAfter).toBe(netCountBefore);

		expect(store.completeWire(sinkPin)).toEqual({ ok: false, error: 'no-pending-wire' });
		expect(store.beginWire({ componentId: source.id, pin: 'missing', side: 'output' })).toEqual({
			ok: false,
			error: 'unknown-pin'
		});
	});

	it('moves and deletes only the selected components', () => {
		const store = new CircuitEditorStore({
			circuit: doc([
				{ id: 'a', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'X' } },
				{ id: 'b', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } },
				{ id: 'c', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Z' } }
			]),
			layouts: {
				'': {
					a: { position: { x: 0, y: 0 } },
					b: { position: { x: 100, y: 0 } },
					c: { position: { x: 200, y: 0 } }
				}
			}
		});
		store.setSelection(['a', 'b']);
		store.moveSelectionBy({ x: 15, y: -25 });
		expect(store.snapshot.layout.a.position).toEqual(snapPoint({ x: 15, y: -25 }));
		expect(store.snapshot.layout.b.position).toEqual(snapPoint({ x: 115, y: -25 }));
		expect(store.snapshot.layout.c.position).toEqual({ x: 200, y: 0 });

		expect(store.deleteSelection()).toBe(2);
		expect(store.snapshot.document.components.map((component) => component.id)).toEqual(['c']);
		expect(store.snapshot.layout.a).toBeUndefined();
		expect(store.snapshot.layout.b).toBeUndefined();
		expect(store.snapshot.selection.size).toBe(0);
	});

	it('places the same grid position at every zoom and keeps unselected layout intact', () => {
		const store = new CircuitEditorStore();
		const viewport: Viewport = { scale: 0.75, offset: { x: -240, y: 96 } };
		const first = expectOk(store.placeComponentAtScreen('not', worldToScreen(viewport, { x: 31, y: 44 }), viewport));
		expect(store.snapshot.layout[first.id].position).toEqual({ x: 30, y: 40 });
	});
});

describe('editor subcircuit authoring', () => {
	const baseComponents: Component[] = [
		{ id: 'sw1', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
		{ id: 'sw2', kind: 'switch', inputs: {}, outputs: { out: 'B' } },
		{ id: 'x1', kind: 'xor', inputs: { a: 'A', b: 'B' }, outputs: { out: 'SUM' } },
		{ id: 'a1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'CARRY' } },
		{ id: 'p1', kind: 'probe', inputs: { in: 'SUM' }, outputs: {} },
		{ id: 'p2', kind: 'probe', inputs: { in: 'CARRY' }, outputs: {} }
	];
	const baseLayout: LayoutMap = {
		sw1: { position: { x: 0, y: 0 } },
		sw2: { position: { x: 0, y: 100 } },
		x1: { position: { x: 200, y: 0 } },
		a1: { position: { x: 200, y: 100 } },
		p1: { position: { x: 400, y: 0 } },
		p2: { position: { x: 400, y: 100 } }
	};

	function seedStore(): CircuitEditorStore {
		return new CircuitEditorStore({
			circuit: doc(baseComponents.map((component) => ({ ...component }))),
			layouts: { '': baseLayout }
		});
	}

	it('packages a selection with inferred boundary pins and replaces it with an instance', () => {
		const store = seedStore();
		store.setSelection(['x1', 'a1']);
		const draft = expectOk(store.beginPackaging());
		const directions = Object.fromEntries(
			draft.candidates.map((candidate) => [candidate.netId, candidate.direction])
		);
		expect(directions).toEqual({ A: 'input', B: 'input', SUM: 'output', CARRY: 'output' });

		const instanceId = expectOk(store.confirmPackage('halfAdder'));
		const snapshot = store.snapshot;
		const ids = snapshot.circuit.components.map((component) => component.id);
		expect(ids).toContain(instanceId);
		expect(ids).not.toContain('x1');
		expect(ids).not.toContain('a1');
		expect(snapshot.definitions.halfAdder.document.components.map((component) => component.id).sort()).toEqual([
			'a1',
			'x1'
		]);
		expect(snapshot.definitions.halfAdder.inputs).toEqual({ A: 'A', B: 'B' });
		expect(snapshot.definitions.halfAdder.outputs).toEqual({ SUM: 'SUM', CARRY: 'CARRY' });
		expect(snapshot.selection.has(instanceId)).toBe(true);
		expect(snapshot.layout['x1']).toBeUndefined();
		const instance = snapshot.circuit.components.find((component) => component.id === instanceId);
		expect(instance?.params).toEqual({ definition: 'halfAdder' });
		expect(instance?.inputs).toEqual({ A: 'A', B: 'B' });
	});

	it('rejects packaging with no selection and with conflicting drivers', () => {
		const store = seedStore();
		expect(store.beginPackaging()).toEqual({ ok: false, error: 'empty-selection' });

		const conflicting = new CircuitEditorStore({
			circuit: doc([
				{ id: 'x1', kind: 'xor', inputs: { a: 'A', b: 'B' }, outputs: { out: 'SUM' } },
				{ id: 'swx', kind: 'switch', inputs: {}, outputs: { out: 'SUM' } },
				{ id: 'p1', kind: 'probe', inputs: { in: 'A' }, outputs: {} }
			])
		});
		conflicting.setSelection(['x1']);
		const result = conflicting.beginPackaging();
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('multiple-drivers');
	});

	it('round-trips a packaged definition after editing the nested definition', () => {
		const store = seedStore();
		store.setSelection(['x1', 'a1']);
		expect(store.beginPackaging().ok).toBe(true);
		const instanceId = expectOk(store.confirmPackage('halfAdder'));

		expect(store.enterDefinition('halfAdder').ok).toBe(true);
		expect(store.snapshot.path).toEqual(['halfAdder']);
		store.setLabel('x1', 'XOR bit');
		const buffer = expectOk(store.placeComponent('buffer', { x: 0, y: 200 }));
		const innerProbe = expectOk(store.placeComponent('probe', { x: 220, y: 200 }));
		expect(store.beginWire({ componentId: 'x1', pin: 'out', side: 'output' }).ok).toBe(true);
		expect(store.completeWire({ componentId: buffer.id, pin: 'a', side: 'input' }).ok).toBe(true);
		expect(store.beginWire({ componentId: buffer.id, pin: 'out', side: 'output' }).ok).toBe(true);
		expect(store.completeWire({ componentId: innerProbe.id, pin: 'in', side: 'input' }).ok).toBe(true);
		expect(store.snapshot.layout.x1?.label).toBe('XOR bit');
		expect(store.navigateTo(0).ok).toBe(true);
		expect(store.snapshot.path).toEqual([]);
		expect(store.snapshot.document.components.find((c) => c.id === instanceId)).toBeDefined();

		const flat = store.flattenCurrent();
		const handFlattened = flatten(doc(baseComponents.map((component) => ({ ...component }))), {}, primitiveKinds);
		for (const a of [0, 1] as const) {
			for (const b of [0, 1] as const) {
				const hierarchical = new Simulator(flat, primitiveKinds);
				const flatReference = new Simulator(handFlattened, primitiveKinds);
				for (const sim of [hierarchical, flatReference]) {
					sim.setState('sw1', { value: a });
					sim.setState('sw2', { value: b });
					expect(sim.settle().status).toBe('stable');
				}
				expect(hierarchical.getNet('SUM')).toBe(a ^ b);
				expect(hierarchical.getNet('CARRY')).toBe(a & b);
				expect(hierarchical.getNet('SUM')).toBe(flatReference.getNet('SUM'));
				expect(hierarchical.getNet('CARRY')).toBe(flatReference.getNet('CARRY'));
			}
		}
	});

	it('instantiates a definition and wires its pins through the store', () => {
		const store = seedStore();
		store.setSelection(['x1', 'a1']);
		expect(store.beginPackaging().ok).toBe(true);
		expectOk(store.confirmPackage('halfAdder'));
		const second = expectOk(store.instantiateDefinition('halfAdder', { x: 600, y: 0 }));
		expect(store.snapshot.layout[second.id].position).toEqual({ x: 600, y: 0 });
		expect(
			store.assignPin({ componentId: second.id, pin: 'A', side: 'input' }, 'A').ok
		).toBe(true);
		expect(
			store.assignPin({ componentId: second.id, pin: 'B', side: 'input' }, 'B').ok
		).toBe(true);
		expect(
			store.assignPin({ componentId: second.id, pin: 'SUM', side: 'output' }, 'SUM2').ok
		).toBe(true);
		expect(
			store.assignPin({ componentId: second.id, pin: 'CARRY', side: 'output' }, 'CARRY2').ok
		).toBe(true);
		const flattened = store.flattenCurrent();
		const sim = new Simulator(flattened, primitiveKinds);
		sim.setState('sw1', { value: 1 });
		sim.setState('sw2', { value: 0 });
		expect(sim.settle().status).toBe('stable');
		expect(sim.getNet('SUM2')).toBe(1);
		expect(sim.getNet('CARRY2')).toBe(0);
	});
});

describe('inspector property edits', () => {
	function seedStore(): CircuitEditorStore {
		return new CircuitEditorStore({
			circuit: doc([
				{ id: 'u1', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } },
				{
					id: 'rom1',
					kind: 'rom',
					inputs: { a0: 'A0', a1: 'A1' },
					outputs: { d0: 'D0', d1: 'D1' },
					params: { wordBits: 2, contents: [0, 1, 2, 3] }
				},
				{
					id: 'ram1',
					kind: 'ram',
					inputs: { we: 'WE', clk: 'CLK' },
					outputs: { q0: 'Q0' },
					params: { wordBits: 8 }
				},
				{ id: 'clk1', kind: 'clock', inputs: {}, outputs: { out: 'CLK' }, params: { polarity: 'rising' } }
			]),
			layouts: { '': { u1: { position: { x: 0, y: 0 } } } }
		});
	}

	it('persists labels, flip-flop type, clock polarity, widths, and memory contents', () => {
		const store = seedStore();
		expect(store.setLabel('u1', 'PC register').ok).toBe(true);
		expect(store.snapshot.layout.u1.label).toBe('PC register');
		const scene = buildScene({
			document: store.snapshot.document,
			layout: store.snapshot.layout
		});
		expect(scene.components.find((component) => component.id === 'u1')?.label).toBe('PC register');

		expect(store.setComponentKind('u1', 'jkFlipFlop').ok).toBe(true);
		const ff = store.snapshot.document.components.find((component) => component.id === 'u1');
		expect(ff?.kind).toBe('jkFlipFlop');
		expect(ff?.inputs).toEqual({ clk: 'CLK' });
		expect(ff?.outputs).toEqual({ q: 'Q', qn: 'QN' });

		expect(store.setClockPolarity('clk1', 'falling').ok).toBe(true);
		expect(
			store.snapshot.document.components.find((component) => component.id === 'clk1')?.params
		).toEqual({ polarity: 'falling' });
		expect(store.setClockPolarity('u1', 'falling')).toEqual({ ok: false, error: 'not-a-clock' });

		expect(store.setBusWidth('ram1', 16).ok).toBe(true);
		expect(
			store.snapshot.document.components.find((component) => component.id === 'ram1')?.params
		).toEqual({ wordBits: 16 });

		expect(store.setParam('rom1', 'contents', [3, 2, 1, 0]).ok).toBe(true);
		expect(
			store.snapshot.document.components.find((component) => component.id === 'rom1')?.params
		).toEqual({ wordBits: 2, contents: [3, 2, 1, 0] });
		expect(store.setBusWidth('ram1', 0)).toEqual({ ok: false, error: 'invalid-width' });
		expect(store.setLabel('missing', 'x')).toEqual({ ok: false, error: 'unknown-component' });
	});

	it('carries signal values into the scene presentation for the canvas', () => {
		const store = seedStore();
		store.setNetValue('D', 1);
		store.setNetValue('Q', 'X', true);
		const scene = buildScene({
			document: store.snapshot.document,
			layout: store.snapshot.layout,
			values: store.snapshot.netValues,
			oscillating: store.snapshot.oscillatingNets
		});
		expect(scene.wires.find((wire) => wire.netId === 'D')?.signal).toMatchObject({
			value: 1,
			level: 'high'
		});
		expect(scene.wires.find((wire) => wire.netId === 'Q')?.signal).toMatchObject({
			value: 'X',
			oscillating: true
		});
		store.clearNetValues();
		expect(store.snapshot.netValues).toEqual({});
	});

	it('applies a batch of simulation values with a single notification', () => {
		const store = seedStore();
		let notifications = 0;
		const unsubscribe = store.subscribe(() => {
			notifications += 1;
		});
		const before = notifications;
		store.applyNetValues([
			{ net: 'D', value: 1, oscillating: false },
			{ net: 'Q', value: 0, oscillating: false },
			{ net: 'CLK', value: 'X', oscillating: true }
		]);
		expect(notifications - before).toBe(1);
		expect(store.snapshot.netValues).toEqual({ D: 1, Q: 0, CLK: 'X' });
		expect([...store.snapshot.oscillatingNets]).toEqual(['CLK']);
		store.applyNetValues([{ net: 'CLK', value: 1, oscillating: false }]);
		expect(store.snapshot.oscillatingNets.size).toBe(0);
		unsubscribe();
	});

	it('loads a replacement document and resets editing state', () => {
		const store = seedStore();
		expectOk(store.placeComponent('and', { x: 40, y: 40 }));
		expect(store.snapshot.document.components.length).toBeGreaterThan(0);

		store.loadDocument({
			circuit: doc([{ id: 'z1', kind: 'not', inputs: { in: 'n1' }, outputs: { out: 'n2' } }]),
			definitions: {},
			layouts: { '': { z1: { position: { x: 20, y: 20 } } } }
		});

		expect(store.snapshot.path).toEqual([]);
		expect(store.snapshot.selection.size).toBe(0);
		expect(store.snapshot.document.components.map((component) => component.id)).toEqual(['z1']);
		const placed = expectOk(store.placeComponent('and', { x: 0, y: 0 }));
		expect(placed.id).not.toBe('z1');
	});
});

describe('parameterized nodes store adoption (U2)', () => {
	function wireWord(
		store: CircuitEditorStore,
		id: string,
		prefixIn: string,
		prefixOut: string,
		width: number
	): void {
		for (let i = 0; i < width; i++) {
			expect(
				store.assignPin({ componentId: id, pin: `${prefixIn}${i}`, side: 'input' }, `${prefixIn.toUpperCase()}${i}`)
					.ok
			).toBe(true);
			expect(
				store.assignPin({ componentId: id, pin: `${prefixOut}${i}`, side: 'output' }, `${prefixOut.toUpperCase()}${i}`)
					.ok
			).toBe(true);
		}
	}

	it('places all six families with KTD5 defaults', () => {
		const store = new CircuitEditorStore();
		const expectations: Array<[string, Record<string, unknown>]> = [
			['rippleCarryAdder', { width: 8 }],
			['magnitudeComparator', { width: 8 }],
			['register', { width: 8 }],
			['registerFile', { addressBits: 4, wordBits: 8 }],
			['ram', { addressBits: 4, wordBits: 8 }],
			['rom', { wordBits: 8, contents: new Array(16).fill(0) }]
		];
		for (const [kind, defaults] of expectations) {
			expect(store.beginPlacement(kind)).toEqual({ ok: true });
			const placed = expectOk(store.placeComponent(kind, { x: 0, y: 0 }));
			expect(placed.params).toEqual(defaults);
		}
		// magnitudeComparator resolves despite its absence from the old width list.
		const comp = store.snapshot.document.components.find((c) => c.kind === 'magnitudeComparator');
		expect(comp).toBeDefined();
		expect(
			store.assignPin({ componentId: comp!.id, pin: 'a0', side: 'input' }, 'A0').ok
		).toBe(true);
		expect(
			store.assignPin({ componentId: comp!.id, pin: 'b7', side: 'input' }, 'B7').ok
		).toBe(true);
	});

	it('grows 8-to-16-bit register keeping d0-d7/q0-q7 nets (AE2)', () => {
		const store = new CircuitEditorStore();
		const reg = expectOk(store.placeComponent('register', { x: 0, y: 0 }));
		expect(reg.params).toEqual({ width: 8 });
		expect(
			store.assignPin({ componentId: reg.id, pin: 'clk', side: 'input' }, 'CLK').ok
		).toBe(true);
		wireWord(store, reg.id, 'd', 'q', 8);
		const grown = store.setBusWidth(reg.id, 16);
		expect(grown.ok).toBe(true);
		if (!grown.ok) throw new Error('grow failed');
		expect(grown.value).toBe(0);
		const after = store.snapshot.document.components.find((c) => c.id === reg.id)!;
		expect(after.params).toEqual({ width: 16 });
		for (let i = 0; i < 8; i++) {
			expect(after.inputs[`d${i}`]).toBe(`D${i}`);
			expect(after.outputs[`q${i}`]).toBe(`Q${i}`);
		}
		for (let i = 8; i < 16; i++) {
			expect(after.inputs[`d${i}`]).toBeUndefined();
			expect(after.outputs[`q${i}`]).toBeUndefined();
		}
		// New bits are placeable pins.
		expect(store.beginWire({ componentId: reg.id, pin: 'd15', side: 'input' }).ok).toBe(true);
		store.cancelWire();
		expect(store.beginWire({ componentId: reg.id, pin: 'q15', side: 'output' }).ok).toBe(true);
		store.cancelWire();
	});

	it('shrinks 16-to-8 dropping vanished pins and returning the dropped-net count', () => {
		const store = new CircuitEditorStore();
		const reg = expectOk(store.placeComponent('register', { x: 0, y: 0 }, { width: 16 }));
		expect(
			store.assignPin({ componentId: reg.id, pin: 'clk', side: 'input' }, 'CLK').ok
		).toBe(true);
		wireWord(store, reg.id, 'd', 'q', 16);
		const shrunk = store.setBusWidth(reg.id, 8);
		expect(shrunk.ok).toBe(true);
		if (!shrunk.ok) throw new Error('shrink failed');
		expect(shrunk.value).toBe(16);
		const after = store.snapshot.document.components.find((c) => c.id === reg.id)!;
		for (let i = 0; i < 8; i++) {
			expect(after.inputs[`d${i}`]).toBe(`D${i}`);
			expect(after.outputs[`q${i}`]).toBe(`Q${i}`);
		}
		for (let i = 8; i < 16; i++) {
			expect(after.inputs[`d${i}`]).toBeUndefined();
			expect(after.outputs[`q${i}`]).toBeUndefined();
		}
		expect(after.inputs['clk']).toBe('CLK');
	});

	it('rejects invalid widths and keeps params unchanged', () => {
		const store = new CircuitEditorStore();
		const reg = expectOk(store.placeComponent('register', { x: 0, y: 0 }));
		expect(store.setBusWidth(reg.id, 0)).toEqual({ ok: false, error: 'invalid-width' });
		expect(store.setBusWidth(reg.id, 33)).toEqual({ ok: false, error: 'invalid-width' });
		expect(store.setBusWidth(reg.id, 2.5)).toEqual({ ok: false, error: 'invalid-width' });
		expect(store.setParam(reg.id, 'width', 0)).toEqual({ ok: false, error: 'invalid-width' });
		expect(store.setParam(reg.id, 'width', 64)).toEqual({ ok: false, error: 'invalid-width' });
		const after = store.snapshot.document.components.find((c) => c.id === reg.id)!;
		expect(after.params).toEqual({ width: 8 });
		// magnitudeComparator width edits work.
		const comp = expectOk(store.placeComponent('magnitudeComparator', { x: 100, y: 0 }));
		const resized = store.setBusWidth(comp.id, 4);
		expect(resized.ok).toBe(true);
		expect(store.snapshot.document.components.find((c) => c.id === comp.id)?.params).toEqual({
			width: 4
		});
	});

	it('keeps addressBits and wordBits independent for RAM and registerFile', () => {
		const store = new CircuitEditorStore();
		const ram = expectOk(store.placeComponent('ram', { x: 0, y: 0 }));
		expect(ram.params).toEqual({ addressBits: 4, wordBits: 8 });
		expect(store.setParam(ram.id, 'addressBits', 2).ok).toBe(true);
		let after = store.snapshot.document.components.find((c) => c.id === ram.id)!;
		expect(after.params).toEqual({ addressBits: 2, wordBits: 8 });
		// setBusWidth touches wordBits only and never creates a collapsed width param.
		const resized = store.setBusWidth(ram.id, 4);
		expect(resized.ok).toBe(true);
		after = store.snapshot.document.components.find((c) => c.id === ram.id)!;
		expect(after.params).toEqual({ addressBits: 2, wordBits: 4 });
		expect('width' in (after.params ?? {})).toBe(false);

		const rf = expectOk(store.placeComponent('registerFile', { x: 200, y: 0 }));
		const rfResized = store.setBusWidth(rf.id, 4);
		expect(rfResized.ok).toBe(true);
		const rfAfter = store.snapshot.document.components.find((c) => c.id === rf.id)!;
		expect(rfAfter.params).toEqual({ addressBits: 4, wordBits: 4 });
		expect('width' in (rfAfter.params ?? {})).toBe(false);
	});

	it('leaves static documents unchanged and round-trips parameterized params', () => {
		const store = new CircuitEditorStore({
			circuit: doc([
				{ id: 'g1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } }
			])
		});
		const reg = expectOk(store.placeComponent('register', { x: 100, y: 0 }));
		const gate = store.snapshot.document.components.find((c) => c.id === 'g1')!;
		expect(gate.inputs).toEqual({ a: 'A', b: 'B' });
		expect(gate.outputs).toEqual({ out: 'Y' });
		const json = JSON.stringify(store.snapshot.document);
		const revived = JSON.parse(json) as CircuitDocument;
		const reloaded = new CircuitEditorStore({ circuit: revived });
		expect(reloaded.snapshot.document.components.find((c) => c.id === reg.id)?.params).toEqual({
			width: 8
		});
		expect(reloaded.snapshot.document.components.find((c) => c.id === 'g1')).toEqual(gate);
	});
});
