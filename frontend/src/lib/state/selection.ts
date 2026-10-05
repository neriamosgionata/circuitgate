import type { CircuitDocument, Component, ComponentId } from '../model/circuit';
import {
	componentSize,
	rectIntersects,
	snapPoint,
	type LayoutMap,
	type Point,
	type Rect
} from '../render/geometry';

export type Selection = ReadonlySet<ComponentId>;

export interface PinSpec {
	inputs: readonly string[];
	outputs: readonly string[];
}

export type PinResolver = (component: Component) => PinSpec;

export function emptySelection(): Selection {
	return new Set<ComponentId>();
}

export function isSelected(selection: Selection, id: ComponentId): boolean {
	return selection.has(id);
}

export function withSelection(selection: Selection, ids: Iterable<ComponentId>): Selection {
	return new Set(ids);
}

export function withoutSelected(selection: Selection, ids: Iterable<ComponentId>): Selection {
	const next = new Set(selection);
	for (const id of ids) next.delete(id);
	return next;
}

export function toggleSelected(selection: Selection, id: ComponentId): Selection {
	const next = new Set(selection);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

export function componentBounds(
	component: Component,
	layout: LayoutMap,
	resolve: PinResolver
): Rect {
	const entry = layout[component.id];
	const position = entry?.position ?? { x: 0, y: 0 };
	const label = entry?.label ?? component.id;
	const pins = resolve(component);
	const size = componentSize(label, pins.inputs.length, pins.outputs.length);
	return { x: position.x, y: position.y, width: size.width, height: size.height };
}

export function selectInRect(
	document: CircuitDocument,
	layout: LayoutMap,
	resolve: PinResolver,
	rect: Rect
): Selection {
	const selected = new Set<ComponentId>();
	for (const component of document.components) {
		if (rectIntersects(componentBounds(component, layout, resolve), rect)) {
			selected.add(component.id);
		}
	}
	return selected;
}

export function selectionBounds(
	document: CircuitDocument,
	layout: LayoutMap,
	resolve: PinResolver,
	ids: Selection
): Rect | null {
	let bounds: Rect | null = null;
	for (const component of document.components) {
		if (!ids.has(component.id)) continue;
		const rect = componentBounds(component, layout, resolve);
		if (!bounds) {
			bounds = rect;
		} else {
			const x = Math.min(bounds.x, rect.x);
			const y = Math.min(bounds.y, rect.y);
			const right = Math.max(bounds.x + bounds.width, rect.x + rect.width);
			const bottom = Math.max(bounds.y + bounds.height, rect.y + rect.height);
			bounds = { x, y, width: right - x, height: bottom - y };
		}
	}
	return bounds;
}

export function movePositions(
	layout: LayoutMap,
	ids: Selection,
	delta: Point,
	grid?: number
): LayoutMap {
	const next: Record<string, { position: Point; label?: string }> = {};
	for (const [id, entry] of Object.entries(layout)) {
		next[id] = entry.label === undefined
			? { position: { ...entry.position } }
			: { position: { ...entry.position }, label: entry.label };
	}
	for (const id of ids) {
		const entry = next[id];
		if (!entry) continue;
		const moved = { x: entry.position.x + delta.x, y: entry.position.y + delta.y };
		entry.position = grid === undefined ? snapPoint(moved) : snapPoint(moved, grid);
	}
	return next;
}

export function removeComponents(document: CircuitDocument, ids: Selection): CircuitDocument {
	return {
		schemaVersion: 1,
		components: document.components.filter((component) => !ids.has(component.id))
	};
}

export function removeLayoutEntries(
	layout: LayoutMap,
	ids: Selection
): Record<string, { position: Point; label?: string }> {
	const next: Record<string, { position: Point; label?: string }> = {};
	for (const [id, entry] of Object.entries(layout)) {
		if (ids.has(id)) continue;
		next[id] = entry;
	}
	return next;
}
