import { describe, expect, it } from 'vitest';
import { SpatialIndex, buildSceneIndex, cullScene, type Bounded } from '../culling';
import { viewportWorldRect, type Rect } from '../geometry';

const item = (id: string, x: number, y: number, width = 64, height = 42): Bounded => ({
	id,
	rect: { x, y, width, height }
});

const components: Bounded[] = [item('a', 0, 0), item('b', 500, 0), item('c', 1000, 0)];
const wires: Bounded[] = [
	{ id: 'w1', rect: { x: 64, y: 10, width: 436, height: 10 } },
	{ id: 'w2', rect: { x: 900, y: 10, width: 80, height: 10 } }
];
const scene = { components, wires };
const index = buildSceneIndex(scene);
const view = (rect: Rect) => cullScene(scene, index, rect);

describe('viewport culling', () => {
	it('excludes offscreen components and keeps the ones inside the viewport', () => {
		const visible = view({ x: 520, y: -10, width: 200, height: 100 });
		expect(visible.components.map((component) => component.id)).toEqual(['b']);
		expect(visible.wires.map((wire) => wire.id)).toEqual([]);
	});

	it('includes a component that only touches the viewport boundary', () => {
		expect(view({ x: 180, y: 0, width: 320, height: 42 }).components.map((c) => c.id)).toEqual(['b']);
		expect(view({ x: 180, y: 0, width: 319, height: 42 }).components).toEqual([]);
	});

	it('includes wires crossing the viewport even when their endpoints are outside', () => {
		const visible = view({ x: 200, y: 0, width: 100, height: 40 });
		expect(visible.components).toEqual([]);
		expect(visible.wires.map((wire) => wire.id)).toEqual(['w1']);
	});

	it('returns everything when the viewport covers the scene', () => {
		const visible = view({ x: -100, y: -100, width: 5000, height: 5000 });
		expect(visible.components).toHaveLength(3);
		expect(visible.wires).toHaveLength(2);
	});

	it('culls using the visible world rect derived from a zoomed and panned viewport', () => {
		const worldRect = viewportWorldRect({ scale: 0.5, offset: { x: -200, y: 0 } }, 800, 400);
		expect(worldRect).toEqual({ x: 400, y: 0, width: 1600, height: 800 });
		const visible = view({ x: 400, y: 0, width: 1600, height: 800 });
		expect(visible.components.map((component) => component.id)).toEqual(['b', 'c']);
	});
});

describe('spatial index', () => {
	it('returns an empty list before any insert and deduplicates cell hits', () => {
		const empty = new SpatialIndex(32);
		expect(empty.query({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
		empty.insert('long', { x: 0, y: 0, width: 100, height: 5 });
		expect(empty.query({ x: 0, y: 0, width: 100, height: 5 })).toEqual(['long']);
	});

	it('keeps oversized items queryable through the fallback list', () => {
		const spatial = new SpatialIndex(16);
		spatial.insert('huge', { x: 0, y: 0, width: 100_000, height: 8 });
		spatial.insert('small', { x: 5, y: 0, width: 4, height: 4 });
		expect(spatial.query({ x: 50_000, y: 0, width: 10, height: 10 }).sort()).toEqual(['huge']);
		expect(spatial.query({ x: 0, y: 0, width: 20, height: 20 }).sort()).toEqual(['huge', 'small']);
	});

	it('rejects a non-positive cell size', () => {
		expect(() => new SpatialIndex(0)).toThrow(/cellSize/);
	});
});
