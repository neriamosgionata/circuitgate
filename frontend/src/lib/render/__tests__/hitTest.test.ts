import { describe, expect, it } from 'vitest';
import { Simulator } from '../../engine/evaluate';
import { primitiveKinds } from '../../engine/primitives';
import type { CircuitDocument } from '../../model/circuit';
import { hitTest, hitTestWorld, type PinHit } from '../hitTest';
import { buildScene, type Scene } from '../scene';
import { worldToScreen, type LayoutMap, type Viewport } from '../geometry';

const document: CircuitDocument = {
	schemaVersion: 1,
	components: [
		{ id: 'g1', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } },
		{ id: 'p1', kind: 'probe', inputs: { in: 'Y' }, outputs: {} }
	]
};

const layout: LayoutMap = {
	g1: { position: { x: 0, y: 0 }, label: 'and' },
	p1: { position: { x: 200, y: 0 }, label: 'p1' }
};

function makeScene(): Scene {
	const sim = new Simulator(document, primitiveKinds);
	sim.setNet('A', 0);
	sim.setNet('B', 1);
	sim.settle();
	return buildScene({
		document,
		layout,
		values: { A: 0, B: 1, Y: sim.getNet('Y') ?? 'X' }
	});
}

const pinOf = (scene: Scene, componentId: string, pin: string): PinHit => {
	for (const component of scene.components) {
		if (component.id !== componentId) continue;
		for (const candidate of component.pins) {
			if (candidate.name === pin) {
				return {
					type: 'pin',
					componentId,
					pin,
					side: candidate.side,
					point: candidate.point
				};
			}
		}
	}
	throw new Error(`pin ${componentId}.${pin} not found`);
};

describe('hit testing', () => {
	it('finds the correct component at multiple zoom and pan values', () => {
		const scene = makeScene();
		const gate = scene.components.find((component) => component.id === 'g1');
		const probe = scene.components.find((component) => component.id === 'p1');
		if (!gate || !probe) throw new Error('scene missing components');
		const viewports: Viewport[] = [
			{ scale: 1, offset: { x: 0, y: 0 } },
			{ scale: 0.5, offset: { x: 120, y: -40 } },
			{ scale: 2.5, offset: { x: -310, y: 77 } }
		];
		for (const viewport of viewports) {
			const gateCenter = worldToScreen(viewport, {
				x: gate.rect.x + gate.rect.width / 2,
				y: gate.rect.y + gate.rect.height / 2
			});
			expect(hitTest(scene, viewport, gateCenter), `gate at scale ${viewport.scale}`).toEqual({
				type: 'component',
				id: 'g1'
			});
			const probeCenter = worldToScreen(viewport, {
				x: probe.rect.x + probe.rect.width / 2,
				y: probe.rect.y + probe.rect.height / 2
			});
			expect(hitTest(scene, viewport, probeCenter), `probe at scale ${viewport.scale}`).toEqual({
				type: 'component',
				id: 'p1'
			});
		}
	});

	it('prefers a pin hit over the component body at every zoom', () => {
		const scene = makeScene();
		const pin = pinOf(scene, 'g1', 'a');
		const viewports: Viewport[] = [
			{ scale: 1, offset: { x: 0, y: 0 } },
			{ scale: 3, offset: { x: -10, y: 20 } }
		];
		for (const viewport of viewports) {
			const screen = worldToScreen(viewport, pin.point);
			const hit = hitTest(scene, viewport, screen);
			expect(hit?.type).toBe('pin');
			expect((hit as PinHit).componentId).toBe('g1');
			expect((hit as PinHit).pin).toBe('a');
			expect((hit as PinHit).side).toBe('input');
		}
	});

	it('finds a wire between two pins and misses empty space', () => {
		const scene = makeScene();
		const wire = scene.wires.find((candidate) => candidate.netId === 'Y');
		if (!wire) throw new Error('wire for net Y not found');
		const segment = wire.points.findIndex(
			(_, index) =>
				index < wire.points.length - 1 &&
				Math.abs(wire.points[index].x - wire.points[index + 1].x) < 0.001
		);
		expect(segment).toBeGreaterThanOrEqual(0);
		const midpoint = {
			x: wire.points[segment].x,
			y: (wire.points[segment].y + wire.points[segment + 1].y) / 2
		};
		expect(hitTestWorld(scene, midpoint, { pinRadius: 6, wireTolerance: 4 })).toEqual({
			type: 'wire',
			netId: 'Y'
		});
		expect(hitTestWorld(scene, { x: 500, y: 500 }, { pinRadius: 6, wireTolerance: 4 })).toBeNull();
	});

	it('returns the topmost component when components overlap', () => {
		const stacked: CircuitDocument = {
			schemaVersion: 1,
			components: [
				{ id: 'bottom', kind: 'and', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } },
				{ id: 'top', kind: 'or', inputs: { a: 'A', b: 'B' }, outputs: { out: 'Y' } }
			]
		};
		const scene = buildScene({
			document: stacked,
			layout: { bottom: { position: { x: 0, y: 0 } }, top: { position: { x: 0, y: 0 } } }
		});
		expect(hitTestWorld(scene, { x: 32, y: 21 }, { pinRadius: 0.1, wireTolerance: 0.1 })).toEqual({
			type: 'component',
			id: 'top'
		});
	});
});
