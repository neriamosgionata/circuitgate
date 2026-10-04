export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Viewport {
	scale: number;
	offset: Point;
}

export interface ComponentLayout {
	position: Point;
	label?: string;
}

export type LayoutMap = Readonly<Record<string, ComponentLayout>>;

export const GRID_SIZE = 10;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 8;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function snapToGrid(value: number, grid: number = GRID_SIZE): number {
	if (!(grid > 0)) throw new Error(`grid must be positive, got ${grid}`);
	const snapped = Math.round(value / grid) * grid;
	return Object.is(snapped, -0) ? 0 : snapped;
}

export function snapPoint(point: Point, grid: number = GRID_SIZE): Point {
	return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) };
}

export function worldToScreen(viewport: Viewport, point: Point): Point {
	return {
		x: point.x * viewport.scale + viewport.offset.x,
		y: point.y * viewport.scale + viewport.offset.y
	};
}

export function screenToWorld(viewport: Viewport, point: Point): Point {
	return {
		x: (point.x - viewport.offset.x) / viewport.scale,
		y: (point.y - viewport.offset.y) / viewport.scale
	};
}

export function panViewport(viewport: Viewport, dx: number, dy: number): Viewport {
	return { scale: viewport.scale, offset: { x: viewport.offset.x + dx, y: viewport.offset.y + dy } };
}

export function zoomViewport(
	viewport: Viewport,
	screenPoint: Point,
	factor: number,
	min: number = MIN_ZOOM,
	max: number = MAX_ZOOM
): Viewport {
	const scale = clamp(viewport.scale * factor, min, max);
	const worldPoint = screenToWorld(viewport, screenPoint);
	return {
		scale,
		offset: {
			x: screenPoint.x - worldPoint.x * scale,
			y: screenPoint.y - worldPoint.y * scale
		}
	};
}

export function viewportWorldRect(viewport: Viewport, width: number, height: number): Rect {
	const topLeft = screenToWorld(viewport, { x: 0, y: 0 });
	const bottomRight = screenToWorld(viewport, { x: width, y: height });
	return {
		x: topLeft.x,
		y: topLeft.y,
		width: bottomRight.x - topLeft.x,
		height: bottomRight.y - topLeft.y
	};
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
}

export function rectIntersects(a: Rect, b: Rect): boolean {
	return (
		a.x <= b.x + b.width &&
		a.x + a.width >= b.x &&
		a.y <= b.y + b.height &&
		a.y + a.height >= b.y
	);
}

export function normalizeRect(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y)
	};
}

export function unionRect(a: Rect, b: Rect): Rect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	const right = Math.max(a.x + a.width, b.x + b.width);
	const bottom = Math.max(a.y + a.height, b.y + b.height);
	return { x, y, width: right - x, height: bottom - y };
}

export function rectFromPoints(points: readonly Point[]): Rect {
	if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let minX = points[0].x;
	let minY = points[0].y;
	let maxX = points[0].x;
	let maxY = points[0].y;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) {
		return Math.hypot(point.x - a.x, point.y - a.y);
	}
	const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
	const projectionX = a.x + t * dx;
	const projectionY = a.y + t * dy;
	return Math.hypot(point.x - projectionX, point.y - projectionY);
}

export interface Size {
	width: number;
	height: number;
}

export function componentSize(label: string, inputCount: number, outputCount: number): Size {
	const rows = Math.max(inputCount, outputCount, 1);
	const width = Math.max(64, Math.ceil(label.length) * 7 + 24);
	const height = Math.max(38, rows * 16 + 10);
	return { width, height };
}

export function pinPoint(rect: Rect, side: 'input' | 'output', index: number, count: number): Point | null {
	if (count <= 0 || index < 0 || index >= count) return null;
	const y = rect.y + (rect.height * (index + 1)) / (count + 1);
	return { x: side === 'input' ? rect.x : rect.x + rect.width, y };
}
