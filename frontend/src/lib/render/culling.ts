import { rectIntersects, type Rect } from './geometry';

export interface Bounded {
	id: string;
	rect: Rect;
}

export interface SceneBoundsSource {
	components: readonly Bounded[];
	wires: readonly Bounded[];
}

export interface SceneIndex {
	components: SpatialIndex;
	wires: SpatialIndex;
}

const MAX_CELLS_PER_ITEM = 256;

// Uniform-grid spatial index. Rectangles are registered in every cell they
// touch; queries walk only the cells overlapping the requested rect. Items
// spanning more cells than the cap (very long wires) land in an oversized list
// that every query scans, which keeps a pathological insert bounded.
export class SpatialIndex {
	readonly cellSize: number;
	private readonly cells = new Map<string, string[]>();
	private readonly oversized: string[] = [];
	private minCellX = Number.POSITIVE_INFINITY;
	private minCellY = Number.POSITIVE_INFINITY;
	private maxCellX = Number.NEGATIVE_INFINITY;
	private maxCellY = Number.NEGATIVE_INFINITY;

	constructor(cellSize = 256) {
		if (!(cellSize > 0)) throw new Error(`cellSize must be positive, got ${cellSize}`);
		this.cellSize = cellSize;
	}

	get size(): number {
		let count = this.oversized.length;
		for (const ids of this.cells.values()) count += ids.length;
		return count;
	}

	insert(id: string, rect: Rect): void {
		const minCellX = Math.floor(rect.x / this.cellSize);
		const minCellY = Math.floor(rect.y / this.cellSize);
		const maxCellX = Math.floor((rect.x + rect.width) / this.cellSize);
		const maxCellY = Math.floor((rect.y + rect.height) / this.cellSize);
		const cellCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);
		if (cellCount > MAX_CELLS_PER_ITEM) {
			this.oversized.push(id);
			this.trackBounds(minCellX, minCellY, maxCellX, maxCellY);
			return;
		}
		for (let cy = minCellY; cy <= maxCellY; cy++) {
			for (let cx = minCellX; cx <= maxCellX; cx++) {
				const key = `${cx}:${cy}`;
				const bucket = this.cells.get(key);
				if (bucket) bucket.push(id);
				else this.cells.set(key, [id]);
			}
		}
		this.trackBounds(minCellX, minCellY, maxCellX, maxCellY);
	}

	query(rect: Rect): string[] {
		if (this.cells.size === 0 && this.oversized.length === 0) return [];
		const minCellX = Math.max(Math.floor(rect.x / this.cellSize), this.minCellX);
		const minCellY = Math.max(Math.floor(rect.y / this.cellSize), this.minCellY);
		const maxCellX = Math.min(Math.floor((rect.x + rect.width) / this.cellSize), this.maxCellX);
		const maxCellY = Math.min(Math.floor((rect.y + rect.height) / this.cellSize), this.maxCellY);
		const seen = new Set<string>(this.oversized);
		for (let cy = minCellY; cy <= maxCellY; cy++) {
			for (let cx = minCellX; cx <= maxCellX; cx++) {
				const bucket = this.cells.get(`${cx}:${cy}`);
				if (!bucket) continue;
				for (const id of bucket) seen.add(id);
			}
		}
		return [...seen];
	}

	private trackBounds(minCellX: number, minCellY: number, maxCellX: number, maxCellY: number): void {
		this.minCellX = Math.min(this.minCellX, minCellX);
		this.minCellY = Math.min(this.minCellY, minCellY);
		this.maxCellX = Math.max(this.maxCellX, maxCellX);
		this.maxCellY = Math.max(this.maxCellY, maxCellY);
	}
}

export function buildSceneIndex(source: SceneBoundsSource, cellSize = 256): SceneIndex {
	const components = new SpatialIndex(cellSize);
	const wires = new SpatialIndex(cellSize);
	for (const component of source.components) components.insert(component.id, component.rect);
	for (const wire of source.wires) wires.insert(wire.id, wire.rect);
	return { components, wires };
}

export interface CullResult<C extends Bounded, W extends Bounded> {
	components: C[];
	wires: W[];
}

// Keeps every item whose bounds intersect the visible world rect, including
// items that only touch the boundary, because touching means partially visible.
export function cullScene<C extends Bounded, W extends Bounded>(
	source: { components: readonly C[]; wires: readonly W[] },
	index: SceneIndex,
	worldRect: Rect
): CullResult<C, W> {
	const visibleComponents = new Set(index.components.query(worldRect));
	const visibleWires = new Set(index.wires.query(worldRect));
	return {
		components: source.components.filter(
			(component) => visibleComponents.has(component.id) && rectIntersects(component.rect, worldRect)
		),
		wires: source.wires.filter(
			(wire) => visibleWires.has(wire.id) && rectIntersects(wire.rect, worldRect)
		)
	};
}
