import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { cullScene } from '../culling';
import { buildScene, presentSignal } from '../scene';

const document: CircuitDocument = {
	schemaVersion: 1,
	components: [
		{ id: 'g1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } },
		{ id: 'p1', kind: 'probe', inputs: { in: 'Y' }, outputs: {} }
	]
};

const layout = {
	g1: { position: { x: 0, y: 0 } },
	p1: { position: { x: 200, y: 0 } }
};

describe('signal presentation', () => {
	it('maps 0 solid low and 1 solid high', () => {
		expect(presentSignal(0)).toMatchObject({ level: 'low', pattern: 'solid', oscillating: false });
		expect(presentSignal(1)).toMatchObject({ level: 'high', pattern: 'solid', oscillating: false });
	});

	it('maps X to a hatched unknown and Z to a dashed high-impedance', () => {
		expect(presentSignal('X')).toMatchObject({ level: 'unknown', pattern: 'hatched' });
		expect(presentSignal('Z')).toMatchObject({ level: 'high-z', pattern: 'dashed' });
	});

	it('flags oscillating nets with a distinct treatment', () => {
		const idle = presentSignal(1);
		const oscillating = presentSignal(1, true);
		expect(oscillating.oscillating).toBe(true);
		expect(oscillating.color).not.toBe(idle.color);
	});
});

describe('scene building', () => {
	it('builds components with pins, labels, and routed wires', () => {
		const scene = buildScene({ document, layout });
		expect(scene.components.map((component) => component.id)).toEqual(['g1', 'p1']);
		const gate = scene.components[0];
		expect(gate.pins.map((pin) => `${pin.side}:${pin.name}`)).toEqual([
			'input:a',
			'input:b',
			'output:out'
		]);
		expect(gate.label).toBe('g1');
		const wire = scene.wires.find((candidate) => candidate.netId === 'Y');
		expect(wire).toBeDefined();
		expect(wire?.dangling).toBe(false);
		expect(wire?.points.length).toBeGreaterThanOrEqual(2);
	});

	it('uses layout labels and attaches signal presentations to wires', () => {
		const scene = buildScene({
			document,
			layout: { ...layout, g1: { position: { x: 0, y: 0 }, label: 'ALU bit' } },
			values: { Y: 'X' },
			oscillating: new Set(['Y'])
		});
		expect(scene.components[0].label).toBe('ALU bit');
		const wire = scene.wires.find((candidate) => candidate.netId === 'Y');
		expect(wire?.signal).toMatchObject({ value: 'X', pattern: 'hatched', oscillating: true });
		expect(wire?.signal?.color).toBeTruthy();
	});

	it('marks a net with a single endpoint as dangling', () => {
		const dangling: CircuitDocument = {
			schemaVersion: 1,
			components: [{ id: 'g1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'N1' } }]
		};
		const scene = buildScene({ document: dangling, layout: { g1: { position: { x: 0, y: 0 } } } });
		const wire = scene.wires.find((candidate) => candidate.netId === 'N1');
		expect(wire?.dangling).toBe(true);
		expect(wire?.points).toHaveLength(2);
	});

	it('keeps a 2,000-component scene inside the frame budget for build and culling', () => {
		const components: CircuitDocument['components'] = [];
		const sceneLayout: Record<string, { position: { x: number; y: number } }> = {};
		for (let index = 0; index < 2000; index++) {
			const column = index % 50;
			const row = Math.floor(index / 50);
			const id = `g${index}`;
			const previous = `n${index}`;
			components.push({
				id,
				kind: 'and',
				inputs: { a: previous, b: previous },
				outputs: { out: `n${index + 1}` }
			});
			sceneLayout[id] = { position: { x: column * 90, y: row * 60 } };
		}
		const big: CircuitDocument = { schemaVersion: 1, components };
		const buildStart = performance.now();
		const scene = buildScene({ document: big, layout: sceneLayout });
		const buildMs = performance.now() - buildStart;
		expect(scene.components).toHaveLength(2000);
		expect(scene.wires).toHaveLength(2001);

		const samples: number[] = [];
		for (let frame = 0; frame < 60; frame++) {
			const viewport = {
				x: (frame % 10) * 300,
				y: Math.floor(frame / 10) * 300,
				width: 800,
				height: 600
			};
			const start = performance.now();
			const visible = cullScene(scene, scene.index, viewport);
			samples.push(performance.now() - start);
			expect(visible.components.length).toBeGreaterThan(0);
		}
		samples.sort((a, b) => a - b);
		const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples[samples.length - 1];
		expect(buildMs, `scene build took ${buildMs.toFixed(1)}ms`).toBeLessThan(50);
		expect(p95, `culling p95 took ${p95.toFixed(3)}ms`).toBeLessThan(16);
	});
});
