import type { SpatialIndex } from './culling';
import {
	distanceToSegment,
	rectContainsPoint,
	screenToWorld,
	type Point,
	type Rect,
	type Viewport
} from './geometry';
import type { Scene, SceneComponent, SceneWire } from './scene';

export interface PinHit {
	type: 'pin';
	componentId: string;
	pin: string;
	side: 'input' | 'output';
	point: Point;
}

export interface ComponentHit {
	type: 'component';
	id: string;
}

export interface WireHit {
	type: 'wire';
	netId: string;
}

export type Hit = PinHit | ComponentHit | WireHit;

export interface HitTestOptions {
	pinRadiusPx?: number;
	wireTolerancePx?: number;
}

interface Ordered {
	id: string;
	order: number;
}

function searchRect(point: Point, radius: number): Rect {
	return { x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 };
}

// Pointer queries go through the same spatial index as culling, so picking
// cost tracks what is nearby instead of the document size.
function nearCandidates<T extends Ordered>(
	index: SpatialIndex,
	byId: ReadonlyMap<string, T>,
	point: Point,
	radius: number
): T[] {
	const candidates: T[] = [];
	for (const id of index.query(searchRect(point, radius))) {
		const item = byId.get(id);
		if (item) candidates.push(item);
	}
	candidates.sort((a, b) => b.order - a.order);
	return candidates;
}

function findPin(candidates: readonly SceneComponent[], point: Point, radius: number): PinHit | null {
	let best: PinHit | null = null;
	let bestDistance = radius;
	for (const component of candidates) {
		for (const pin of component.pins) {
			const distance = Math.hypot(point.x - pin.point.x, point.y - pin.point.y);
			if (distance <= bestDistance) {
				bestDistance = distance;
				best = {
					type: 'pin',
					componentId: component.id,
					pin: pin.name,
					side: pin.side,
					point: pin.point
				};
			}
		}
	}
	return best;
}

function findComponent(candidates: readonly SceneComponent[], point: Point): ComponentHit | null {
	for (const component of candidates) {
		if (rectContainsPoint(component.rect, point)) return { type: 'component', id: component.id };
	}
	return null;
}

function findWire(candidates: readonly SceneWire[], point: Point, tolerance: number): WireHit | null {
	let best: WireHit | null = null;
	let bestDistance = tolerance;
	for (const wire of candidates) {
		for (let segment = 0; segment < wire.points.length - 1; segment++) {
			const distance = distanceToSegment(point, wire.points[segment], wire.points[segment + 1]);
			if (distance <= bestDistance) {
				bestDistance = distance;
				best = { type: 'wire', netId: wire.netId };
			}
		}
	}
	return best;
}

// Pointer priority: pins (nearest within the screen-space radius), then the
// topmost component body, then wires. Tolerances are supplied in screen pixels
// and scaled into world units, so picking feels identical at every zoom.
export function hitTestWorld(
	scene: Scene,
	point: Point,
	tolerances: { pinRadius: number; wireTolerance: number }
): Hit | null {
	const reach = Math.max(tolerances.pinRadius, tolerances.wireTolerance, 1);
	const componentCandidates = nearCandidates(
		scene.index.components,
		scene.componentById,
		point,
		reach
	);
	const pin = findPin(componentCandidates, point, tolerances.pinRadius);
	if (pin) return pin;
	const component = findComponent(componentCandidates, point);
	if (component) return component;
	const wireCandidates = nearCandidates(scene.index.wires, scene.wireById, point, reach);
	return findWire(wireCandidates, point, tolerances.wireTolerance);
}

export function hitTest(
	scene: Scene,
	viewport: Viewport,
	screenPoint: Point,
	options: HitTestOptions = {}
): Hit | null {
	const point = screenToWorld(viewport, screenPoint);
	return hitTestWorld(scene, point, {
		pinRadius: (options.pinRadiusPx ?? 6) / viewport.scale,
		wireTolerance: (options.wireTolerancePx ?? 4) / viewport.scale
	});
}
