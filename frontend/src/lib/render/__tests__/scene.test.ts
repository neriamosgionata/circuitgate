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

	it('routes a fan-out net as orthogonal branches with no consumer-to-consumer jump', () => {
		const fanout: CircuitDocument = {
			schemaVersion: 1,
			components: [
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'and1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } },
				{ id: 'not1', kind: 'not', inputs: { a: 'A' }, outputs: { out: 'N' } }
			]
		};
		const scene = buildScene({
			document: fanout,
			layout: {
				sw: { position: { x: 0, y: 60 } },
				and1: { position: { x: 200, y: 0 } },
				not1: { position: { x: 200, y: 140 } }
			}
		});
		const wire = scene.wires.find((candidate) => candidate.netId === 'A');
		const points = wire?.points ?? [];
		expect(points.length).toBeGreaterThan(2);
		for (let index = 0; index < points.length - 1; index++) {
			const from = points[index];
			const to = points[index + 1];
			const orthogonal = Math.abs(from.x - to.x) < 1e-9 || Math.abs(from.y - to.y) < 1e-9;
			expect(
				orthogonal,
				`segment ${index} (${from.x},${from.y})->(${to.x},${to.y}) is diagonal`
			).toBe(true);
		}
	});

	it('routes a net whose driver was deleted outside its remaining pins', () => {
		const floating: CircuitDocument = {
			schemaVersion: 1,
			components: [
				{ id: 'and1', kind: 'and', inputs: { a: 'F', b: 'B' }, outputs: { out: 'Y' } },
				{ id: 'not1', kind: 'not', inputs: { a: 'F' }, outputs: { out: 'N' } }
			]
		};
		const scene = buildScene({
			document: floating,
			layout: {
				and1: { position: { x: 240, y: 0 } },
				not1: { position: { x: 240, y: 120 } }
			}
		});
		const wire = scene.wires.find((candidate) => candidate.netId === 'F');
		const pins = [
			scene.componentById.get('and1')!.pins.find((pin) => pin.name === 'a')!.point,
			scene.componentById.get('not1')!.pins.find((pin) => pin.name === 'a')!.point
		];
		const maxPinX = Math.max(...pins.map((point) => point.x));
		expect(wire).toBeDefined();
		// Both consumer pins stay on the one net.
		for (const pin of pins) {
			expect(wire!.points.some((point) => point.x === pin.x && point.y === pin.y)).toBe(true);
		}
		// With no output driving the net, no lead may be invented on the far
		// side of a pin: that draws a stub into the component body.
		for (const point of wire!.points) {
			expect(point.x, `point ${point.x},${point.y} runs past the pins`).toBeLessThanOrEqual(maxPinX);
		}
	});

	it('draws derived pins at configured widths with one labeled pin per bit (R6)', () => {
		const wide: CircuitDocument = {
			schemaVersion: 1,
			components: [
				{ id: 'r16', kind: 'register', inputs: {}, outputs: {}, params: { width: 16 } },
				{
					id: 'ram1',
					kind: 'ram',
					inputs: {},
					outputs: {},
					params: { addressBits: 2, wordBits: 4 }
				}
			]
		};
		const scene = buildScene({
			document: wide,
			layout: { r16: { position: { x: 0, y: 0 } }, ram1: { position: { x: 300, y: 0 } } }
		});
		const reg = scene.components.find((c) => c.id === 'r16')!;
		expect(reg.pins.map((p) => `${p.side}:${p.name}`)).toContain('input:d15');
		expect(reg.pins.map((p) => `${p.side}:${p.name}`)).toContain('output:q15');
		expect(reg.pins.filter((p) => p.side === 'input')).toHaveLength(17);
		expect(reg.pins.filter((p) => p.side === 'output')).toHaveLength(16);
		// Default-width register stays at 8 for comparison.
		const narrow: CircuitDocument = {
			schemaVersion: 1,
			components: [{ id: 'r8', kind: 'register', inputs: {}, outputs: {}, params: { width: 8 } }]
		};
		const narrowScene = buildScene({ document: narrow, layout: { r8: { position: { x: 0, y: 0 } } } });
		expect(narrowScene.components[0].pins).toHaveLength(17);

		const ram = scene.components.find((c) => c.id === 'ram1')!;
		expect(ram.pins.map((p) => `${p.side}:${p.name}`)).toContain('input:a1');
		expect(ram.pins.map((p) => `${p.side}:${p.name}`)).toContain('input:d3');
		expect(ram.pins.map((p) => `${p.side}:${p.name}`)).toContain('output:q3');
		expect(ram.pins.map((p) => `${p.side}:${p.name}`)).not.toContain('input:a2');
	});

	function buildLargeScene() {
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
		return { scene, buildMs, p95 };
	}

	it('builds and culls a 2,000-component scene', () => {
		const { scene } = buildLargeScene();
		expect(scene.components).toHaveLength(2000);
		expect(scene.wires).toHaveLength(2001);
	});

	const perfIt = process.env.RUN_PERF_SMOKE === '1' ? it : it.skip;

	perfIt('keeps a 2,000-component scene inside the frame budget for build and culling (RUN_PERF_SMOKE=1)', () => {
		const { buildMs, p95 } = buildLargeScene();
		expect(buildMs, `scene build took ${buildMs.toFixed(1)}ms`).toBeLessThan(50);
		expect(p95, `culling p95 took ${p95.toFixed(3)}ms`).toBeLessThan(16);
	});
});
