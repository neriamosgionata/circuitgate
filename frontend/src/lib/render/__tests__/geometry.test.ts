import { describe, expect, it } from 'vitest';
import {
	GRID_SIZE,
	clamp,
	componentSize,
	distanceToSegment,
	normalizeRect,
	panViewport,
	pinPoint,
	rectContainsPoint,
	rectIntersects,
	rectFromPoints,
	screenToWorld,
	snapPoint,
	snapToGrid,
	unionRect,
	viewportWorldRect,
	worldToScreen,
	zoomViewport,
	type Viewport
} from '../geometry';

const identity: Viewport = { scale: 1, offset: { x: 0, y: 0 } };

describe('viewport transforms', () => {
	it('round-trips a world point through screen space at multiple zoom and pan values', () => {
		const viewports: Viewport[] = [
			{ scale: 1, offset: { x: 0, y: 0 } },
			{ scale: 0.5, offset: { x: 120, y: -40 } },
			{ scale: 2.5, offset: { x: -310, y: 77 } }
		];
		for (const viewport of viewports) {
			for (const world of [
				{ x: 57, y: 93 },
				{ x: -204.5, y: 18 }
			]) {
				const roundTrip = screenToWorld(viewport, worldToScreen(viewport, world));
				expect(roundTrip.x).toBeCloseTo(world.x);
				expect(roundTrip.y).toBeCloseTo(world.y);
			}
		}
	});

	it('keeps the world point under the cursor fixed while zooming', () => {
		const cursor = { x: 333, y: 210 };
		const before = screenToWorld(identity, cursor);
		const zoomed = zoomViewport(identity, cursor, 2);
		expect(zoomed.scale).toBe(2);
		const after = screenToWorld(zoomed, cursor);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('clamps zoom to the configured range', () => {
		expect(zoomViewport(identity, { x: 0, y: 0 }, 0.001).scale).toBe(0.2);
		expect(zoomViewport(identity, { x: 0, y: 0 }, 1000).scale).toBe(8);
	});

	it('pans by screen-space deltas', () => {
		const panned = panViewport(identity, 25, -12);
		expect(panned).toEqual({ scale: 1, offset: { x: 25, y: -12 } });
	});

	it('computes the visible world rectangle', () => {
		const rect = viewportWorldRect({ scale: 2, offset: { x: 100, y: 50 } }, 800, 400);
		expect(rect.x).toBeCloseTo(-50);
		expect(rect.y).toBeCloseTo(-25);
		expect(rect.width).toBeCloseTo(400);
		expect(rect.height).toBeCloseTo(200);
	});
});

describe('grid snapping', () => {
	it('snaps values to the nearest grid multiple', () => {
		expect(snapToGrid(14)).toBe(10);
		expect(snapToGrid(15)).toBe(20);
		expect(snapToGrid(-14)).toBe(-10);
		expect(snapToGrid(123.4, 25)).toBe(125);
		expect(GRID_SIZE).toBe(10);
	});

	it('places points predictably at multiple zoom and pan levels', () => {
		const target = { x: 57, y: 63 };
		const viewports: Viewport[] = [
			identity,
			{ scale: 0.5, offset: { x: 240, y: -120 } },
			{ scale: 3, offset: { x: -57, y: 8 } }
		];
		for (const viewport of viewports) {
			const screen = worldToScreen(viewport, target);
			const snapped = snapPoint(screenToWorld(viewport, screen));
			expect(snapped.x).toBe(60);
			expect(snapped.y).toBe(60);
		}
	});
});

describe('rect utilities', () => {
	it('detects point containment inclusively', () => {
		const rect = { x: 10, y: 20, width: 100, height: 50 };
		expect(rectContainsPoint(rect, { x: 60, y: 45 })).toBe(true);
		expect(rectContainsPoint(rect, { x: 10, y: 20 })).toBe(true);
		expect(rectContainsPoint(rect, { x: 110, y: 70 })).toBe(true);
		expect(rectContainsPoint(rect, { x: 111, y: 70 })).toBe(false);
	});

	it('treats touching edges as intersecting', () => {
		const a = { x: 0, y: 0, width: 100, height: 100 };
		expect(rectIntersects(a, { x: 100, y: 20, width: 50, height: 50 })).toBe(true);
		expect(rectIntersects(a, { x: 101, y: 20, width: 50, height: 50 })).toBe(false);
	});

	it('normalizes a drag rectangle regardless of direction', () => {
		expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({
			x: 10,
			y: 20,
			width: 40,
			height: 40
		});
	});

	it('computes bounding rects from points and unions', () => {
		expect(rectFromPoints([{ x: 5, y: 9 }, { x: -3, y: 40 }])).toEqual({
			x: -3,
			y: 9,
			width: 8,
			height: 31
		});
		expect(rectFromPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		expect(unionRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 5, width: 5, height: 5 })).toEqual({
			x: 0,
			y: 0,
			width: 25,
			height: 10
		});
	});
});

describe('segment and pin geometry', () => {
	it('measures distance to a segment including endpoints', () => {
		const a = { x: 0, y: 0 };
		const b = { x: 10, y: 0 };
		expect(distanceToSegment({ x: 5, y: 4 }, a, b)).toBeCloseTo(4);
		expect(distanceToSegment({ x: -3, y: 0 }, a, b)).toBeCloseTo(3);
		expect(distanceToSegment({ x: 4, y: 3 }, a, a)).toBeCloseTo(5);
	});

	it('spaces pins evenly along a component side', () => {
		const rect = { x: 0, y: 0, width: 80, height: 50 };
		expect(pinPoint(rect, 'input', 0, 2)).toEqual({ x: 0, y: 50 / 3 });
		expect(pinPoint(rect, 'output', 1, 2)).toEqual({ x: 80, y: 100 / 3 });
		expect(pinPoint(rect, 'input', 2, 2)).toBeNull();
		expect(pinPoint(rect, 'input', 0, 0)).toBeNull();
	});

	it('sizes components from label and pin count', () => {
		const small = componentSize('and', 2, 1);
		const labeled = componentSize('carry-lookahead', 2, 1);
		const tall = componentSize('ram', 12, 4);
		expect(labeled.width).toBeGreaterThan(small.width);
		expect(tall.height).toBeGreaterThan(small.height);
		expect(clamp(5, 0, 3)).toBe(3);
	});
});
