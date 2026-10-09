<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';

	import {
		clamp,
		panViewport,
		screenToWorld,
		snapPoint,
		worldToScreen,
		zoomViewport,
		viewportWorldRect,
		type Point,
		type Rect,
		type Viewport
	} from '../../render/geometry';
	import {
		buildScene,
		presentSignal,
		SIGNAL_COLORS,
		type SceneComponent,
		type ScenePin,
		type SceneWire,
		type SignalPresentation
	} from '../../render/scene';
	import { cullScene } from '../../render/culling';
	import { hitTest, type PinHit } from '../../render/hitTest';
	import { drawKindGlyph } from '../../render/symbols';
	import type { LogicValue } from '../../engine/values';
	import { analogAnnotations, type AnalogAnnotation } from '../../sim/analog/annotations';
	import type { CircuitEditorStore, EditorSnapshot, PinRef } from '../../state/circuitStore';

	interface Props {
		store: CircuitEditorStore;
		readonly?: boolean;
	}

	let { store, readonly = false }: Props = $props();

	interface OverlayRect {
		id: string;
		left: number;
		top: number;
		width: number;
		height: number;
	}

	interface AnnotationOverlay {
		key: string;
		net?: string;
		componentId?: string;
		value: number;
		text: string;
		left: number;
		top: number;
	}

	type Drag =
		| { kind: 'none' }
		| { kind: 'pan'; last: Point }
		| { kind: 'move'; origin: Map<string, Point>; start: Point }
		| { kind: 'marquee'; start: Point };

	let wrapper: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let viewport = $state<Viewport>({ scale: 1, offset: { x: 48, y: 48 } });
	let size = $state({ width: 960, height: 640 });
	let snapshot = $state<EditorSnapshot>(untrack(() => store.snapshot));
	let overlay = $state<OverlayRect[]>([]);
	let annotationOverlays = $state<AnnotationOverlay[]>([]);
	let marquee = $state<Rect | null>(null);
	let wirePreview = $state<{ from: Point; to: Point } | null>(null);
	let hoveredPin = $state<PinHit | null>(null);
	let drag: Drag = { kind: 'none' };
	let overlaySignature = '';
	let annotationSignature = '';

	// Scene geometry is independent of simulated values: value changes only
	// recolour wires and pins, so the 2,000-component route is not rebuilt
	// on every toggle. The cache keys on the store's stable document,
	// layout, and definitions references rather than the snapshot object.
	let sceneCache: ReturnType<typeof buildScene> | null = null;
	let sceneCacheKey: { circuit: unknown; layout: unknown; definitions: unknown } = {
		circuit: null,
		layout: null,
		definitions: null
	};
	const scene = $derived.by(() => {
		const { circuit, layout, definitions } = snapshot;
		if (
			sceneCache &&
			sceneCacheKey.circuit === circuit &&
			sceneCacheKey.layout === layout &&
			sceneCacheKey.definitions === definitions
		) {
			return sceneCache;
		}
		sceneCache = buildScene({ document: circuit, layout, definitions });
		sceneCacheKey = { circuit, layout, definitions };
		return sceneCache;
	});

	function signalForNet(net: string | undefined): SignalPresentation | null {
		if (!net) return null;
		const value = snapshot.netValues[net];
		return value === undefined ? null : presentSignal(value, snapshot.oscillatingNets.has(net));
	}

	// Operating-point annotations anchor at the middle of the net's wire, or
	// under a device for branch currents.
	function annotationAnchor(annotation: AnalogAnnotation): Point | null {
		if (annotation.net) {
			const wire = scene.wireById.get(annotation.net);
			if (!wire || wire.points.length === 0) return null;
			const middle = wire.points[Math.floor(wire.points.length / 2)];
			return { x: middle.x, y: middle.y - 10 };
		}
		if (annotation.componentId) {
			const component = scene.componentById.get(annotation.componentId);
			if (!component) return null;
			return {
				x: component.rect.x + component.rect.width / 2,
				y: component.rect.y + component.rect.height + 12
			};
		}
		return null;
	}

	$effect(() => {
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	function localPoint(event: PointerEvent | WheelEvent): Point {
		if (!canvas) return { x: 0, y: 0 };
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function asPinRef(hit: PinHit): PinRef {
		return { componentId: hit.componentId, pin: hit.pin, side: hit.side };
	}

	function samePin(a: PinRef, b: PinRef): boolean {
		return a.componentId === b.componentId && a.pin === b.pin && a.side === b.side;
	}

	function findScenePin(ref: PinRef): { component: SceneComponent; pin: ScenePin } | null {
		const component = scene.componentById.get(ref.componentId);
		const pin = component?.pins.find(
			(candidate) => candidate.name === ref.pin && candidate.side === ref.side
		);
		return component && pin ? { component, pin } : null;
	}

	function setHoveredPin(next: PinHit | null) {
		const same =
			hoveredPin === next ||
			(hoveredPin !== null &&
				next !== null &&
				hoveredPin.componentId === next.componentId &&
				hoveredPin.pin === next.pin &&
				hoveredPin.side === next.side);
		if (!same) hoveredPin = next;
	}

	function pinColor(value: LogicValue | undefined): string {
		if (value === undefined) return '#ffffff';
		if (value === 0) return SIGNAL_COLORS.low;
		if (value === 1) return SIGNAL_COLORS.high;
		if (value === 'X') return SIGNAL_COLORS.unknown;
		return SIGNAL_COLORS.highZ;
	}

	// Hover emphasis: a highlighter wash behind an enlarged dot plus the pin
	// name on a mono chip, so the connectable point and its identity are both
	// legible at a glance while wiring.
	function drawHoveredPin(
		ctx: CanvasRenderingContext2D,
		point: Point,
		pin: ScenePin,
		component: SceneComponent
	) {
		const net = pin.side === 'output' ? component.outputs[pin.name] : component.inputs[pin.name];
		ctx.save();
		ctx.fillStyle = '#ffe23d';
		ctx.beginPath();
		ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = pinColor(net ? snapshot.netValues[net] : undefined);
		ctx.beginPath();
		ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = '#1d1d1b';
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.font = '10px "Courier Prime", "Courier New", monospace';
		const chipWidth = Math.ceil(ctx.measureText(pin.name).width) + 10;
		const chipHeight = 16;
		const gap = 13;
		const chipX = clamp(
			pin.side === 'input' ? point.x - gap - chipWidth : point.x + gap,
			4,
			Math.max(4, size.width - chipWidth - 4)
		);
		const chipY = clamp(point.y - chipHeight / 2, 4, Math.max(4, size.height - chipHeight - 4));
		ctx.beginPath();
		ctx.roundRect(chipX, chipY, chipWidth, chipHeight, 3);
		ctx.fillStyle = '#fff3a8';
		ctx.fill();
		ctx.strokeStyle = '#1d4ed8';
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.fillStyle = '#1d4ed8';
		ctx.fillText(pin.name, chipX + chipWidth / 2, chipY + chipHeight / 2 + 0.5);
		ctx.restore();
	}

	function onPointerDown(event: PointerEvent) {
		if (!canvas) return;
		canvas.setPointerCapture(event.pointerId);
		const screen = localPoint(event);
		const world = screenToWorld(viewport, screen);

		if (event.button === 1 || event.button === 2) {
			drag = { kind: 'pan', last: screen };
			setHoveredPin(null);
			return;
		}

		if (readonly) {
			const inspected = hitTest(scene, viewport, screen);
			if (inspected?.type === 'component') {
				if (event.shiftKey) {
					store.toggleSelection(inspected.id);
				} else {
					store.setSelection([inspected.id]);
				}
			} else if (!event.shiftKey) {
				store.clearSelection();
			}
			return;
		}

		if (snapshot.pendingKind) {
			store.placeComponent(snapshot.pendingKind, world);
			store.cancelPlacement();
			store.cancelAssist();
			setHoveredPin(null);
			return;
		}

		const hit = hitTest(scene, viewport, screen);
		if (hit?.type === 'pin') {
			const pin = asPinRef(hit);
			const assist = store.snapshot.pendingAssist;
			if (assist !== null && !samePin(pin, assist.output) && !samePin(pin, assist.input)) {
				store.cancelAssist();
			}
			if (snapshot.pendingWire) {
				store.completeWire(pin);
				wirePreview = null;
			} else if (store.beginWire(pin).ok) {
				wirePreview = { from: hit.point, to: hit.point };
			}
			setHoveredPin(readonly ? null : hit);
			return;
		}

		if (hit?.type === 'component') {
			if (snapshot.pendingWire) {
				store.cancelWire();
				wirePreview = null;
			}
			store.cancelAssist();
			if (event.shiftKey) {
				store.toggleSelection(hit.id);
			} else if (!snapshot.selection.has(hit.id)) {
				store.setSelection([hit.id]);
			}
			const origin = new Map<string, Point>();
			for (const id of store.snapshot.selection) {
				const entry = store.snapshot.layout[id];
				if (entry) origin.set(id, { ...entry.position });
			}
			drag = { kind: 'move', origin, start: world };
			setHoveredPin(null);
			return;
		}

		if (snapshot.pendingWire) {
			store.cancelWire();
			wirePreview = null;
		}
		if (!event.shiftKey) store.clearSelection();
		drag = { kind: 'marquee', start: world };
		marquee = { x: world.x, y: world.y, width: 0, height: 0 };
		store.cancelAssist();
		setHoveredPin(null);
	}

	function onPointerMove(event: PointerEvent) {
		if (!canvas) return;
		const screen = localPoint(event);
		const world = screenToWorld(viewport, screen);
		if (drag.kind === 'pan') {
			viewport = panViewport(viewport, screen.x - drag.last.x, screen.y - drag.last.y);
			drag.last = screen;
			return;
		}
		if (drag.kind === 'move') {
			const total = { x: world.x - drag.start.x, y: world.y - drag.start.y };
			const positions: Record<string, Point> = {};
			for (const [id, origin] of drag.origin) {
				positions[id] = snapPoint({ x: origin.x + total.x, y: origin.y + total.y });
			}
			store.setPositions(positions);
			return;
		}
		if (drag.kind === 'marquee') {
			marquee = {
				x: Math.min(drag.start.x, world.x),
				y: Math.min(drag.start.y, world.y),
				width: Math.abs(world.x - drag.start.x),
				height: Math.abs(world.y - drag.start.y)
			};
			return;
		}
		const hit = hitTest(scene, viewport, screen);
		setHoveredPin(!readonly && hit?.type === 'pin' ? hit : null);
		if (snapshot.pendingWire && wirePreview) {
			wirePreview = {
				from: wirePreview.from,
				to: hit?.type === 'pin' ? hit.point : world
			};
		}
	}

	function onPointerUp(event: PointerEvent) {
		if (!canvas) return;
		const screen = localPoint(event);
		if (drag.kind === 'marquee' && marquee) {
			store.selectInRect(marquee);
		}
		if (snapshot.pendingWire) {
			const hit = hitTest(scene, viewport, screen);
			store.endWire(hit?.type === 'pin' ? asPinRef(hit) : null);
			wirePreview = null;
		}
		drag = { kind: 'none' };
		marquee = null;
	}

	function onPointerLeave() {
		setHoveredPin(null);
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
		viewport = zoomViewport(viewport, localPoint(event), factor);
	}

	function onKeyDown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target.isContentEditable)
		) {
			return;
		}
		if ((event.key === 'Delete' || event.key === 'Backspace') && !readonly) {
			event.preventDefault();
			store.deleteSelection();
		} else if (event.key === 'Escape') {
			store.cancelPlacement();
			store.cancelWire();
			store.cancelPackaging();
			wirePreview = null;
		}
	}

	function zoomAtCenter(factor: number) {
		viewport = zoomViewport(viewport, { x: size.width / 2, y: size.height / 2 }, factor);
	}

	function fitView() {
		const bounds = scene.bounds;
		if (bounds.width <= 0 && bounds.height <= 0) return;
		const padding = 48;
		const scale = clamp(
			Math.min(
				(size.width - padding * 2) / Math.max(bounds.width, 1),
				(size.height - padding * 2) / Math.max(bounds.height, 1)
			),
			0.2,
			8
		);
		viewport = {
			scale,
			offset: { x: padding - bounds.x * scale, y: padding - bounds.y * scale }
		};
	}

	function styleFor(signal: SignalPresentation | null): { color: string; dash: number[]; width: number } {
		if (!signal) return { color: SIGNAL_COLORS.idle, dash: [], width: 1.5 };
		const dash = signal.pattern === 'dashed' ? [6, 4] : signal.oscillating ? [3, 3] : [];
		return { color: signal.color, dash, width: signal.oscillating ? 2.5 : 2 };
	}

	function drawWire(ctx: CanvasRenderingContext2D, wire: SceneWire, signal: SignalPresentation | null) {
		if (wire.points.length < 2) return;
		const style = styleFor(signal);
		const screenPoints = wire.points.map((point) => worldToScreen(viewport, point));
		ctx.save();
		ctx.strokeStyle = style.color;
		ctx.lineWidth = style.width;
		ctx.setLineDash(style.dash);
		ctx.beginPath();
		ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
		for (let index = 1; index < screenPoints.length; index++) {
			ctx.lineTo(screenPoints[index].x, screenPoints[index].y);
		}
		ctx.stroke();
		if (signal?.pattern === 'hatched') {
			ctx.setLineDash([]);
			ctx.lineWidth = 1;
			for (let index = 1; index < screenPoints.length; index++) {
				const from = screenPoints[index - 1];
				const to = screenPoints[index];
				const length = Math.hypot(to.x - from.x, to.y - from.y);
				const steps = Math.floor(length / 8);
				for (let step = 0; step <= steps; step++) {
					const t = steps === 0 ? 0 : step / steps;
					const x = from.x + (to.x - from.x) * t;
					const y = from.y + (to.y - from.y) * t;
					ctx.beginPath();
					ctx.moveTo(x - 2, y + 3);
					ctx.lineTo(x + 2, y - 3);
					ctx.stroke();
				}
			}
		}
		ctx.restore();
	}

	let gridLayer: HTMLCanvasElement | null = null;
	let gridKey = '';

	// The grid is static between viewport changes; rasterise it once per
	// viewport and blit it as a single image. Software rasterisation of the
	// dozens of grid strokes otherwise dominated each repaint.
	function gridFor(width: number, height: number, dpr: number): HTMLCanvasElement {
		const key = `${width}:${height}:${dpr}:${viewport.scale}:${viewport.offset.x}:${viewport.offset.y}`;
		if (gridLayer && gridKey === key) return gridLayer;
		const layer = document.createElement('canvas');
		layer.width = Math.max(1, Math.round(width * dpr));
		layer.height = Math.max(1, Math.round(height * dpr));
		const grid = layer.getContext('2d');
		if (grid) {
			grid.setTransform(dpr, 0, 0, dpr, 0, 0);
			// Drawn grid only; placement snaps to GRID_SIZE (10) and stays there.
			const step = 40;
			if (step * viewport.scale >= 8) {
				const worldRect = viewportWorldRect(viewport, width, height);
				const startX = Math.floor(worldRect.x / step) * step;
				const startY = Math.floor(worldRect.y / step) * step;
				grid.strokeStyle = '#d8d2c2';
				grid.lineWidth = 1;
				for (let x = startX; x <= worldRect.x + worldRect.width; x += step) {
					const screen = worldToScreen(viewport, { x, y: 0 });
					grid.beginPath();
					grid.moveTo(screen.x, 0);
					grid.lineTo(screen.x, height);
					grid.stroke();
				}
				for (let y = startY; y <= worldRect.y + worldRect.height; y += step) {
					const screen = worldToScreen(viewport, { x: 0, y });
					grid.beginPath();
					grid.moveTo(0, screen.y);
					grid.lineTo(width, screen.y);
					grid.stroke();
				}
			}
		}
		gridLayer = layer;
		gridKey = key;
		return layer;
	}

	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.max(1, Math.round(size.width * dpr));
		const pixelHeight = Math.max(1, Math.round(size.height * dpr));
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, size.width, size.height);
		ctx.fillStyle = '#f2efe6';
		ctx.fillRect(0, 0, size.width, size.height);
		ctx.drawImage(gridFor(size.width, size.height, dpr), 0, 0, size.width, size.height);

		const worldRect = viewportWorldRect(viewport, size.width, size.height);
		const visible = cullScene(scene, scene.index, worldRect);

		// Group solid wires by style so a whole class draws as one path.
		const wireGroups = new Map<string, { color: string; width: number; paths: Point[][] }>();
		for (const wire of visible.wires) {
			if (wire.points.length < 2) continue;
			const signal = signalForNet(wire.netId);
			const style = styleFor(signal);
			if (signal?.pattern !== 'solid') {
				drawWire(ctx, wire, signal);
				continue;
			}
			const key = `${style.color}|${style.width}`;
			const group = wireGroups.get(key) ?? { color: style.color, width: style.width, paths: [] };
			group.paths.push(wire.points);
			wireGroups.set(key, group);
		}
		for (const group of wireGroups.values()) {
			ctx.strokeStyle = group.color;
			ctx.lineWidth = group.width;
			ctx.beginPath();
			for (const points of group.paths) {
				const first = worldToScreen(viewport, points[0]);
				ctx.moveTo(first.x, first.y);
				for (let index = 1; index < points.length; index++) {
					const point = worldToScreen(viewport, points[index]);
					ctx.lineTo(point.x, point.y);
				}
			}
			ctx.stroke();
		}

		// Bodies as one fill/stroke pass, labels grouped by font, pins grouped
		// by colour: per-component state changes dominate at 2,000 components.
		ctx.fillStyle = '#fbf9f4';
		ctx.strokeStyle = '#1d1d1b';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (const component of visible.components) {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			ctx.rect(
				topLeft.x,
				topLeft.y,
				component.rect.width * viewport.scale,
				component.rect.height * viewport.scale
			);
		}
		ctx.fill();
		ctx.stroke();

		// Per-kind schematic glyphs in one ink stroke over the paper body.
		// Hit-testing and wiring still use the rect and pin dots; the glyph
		// is presentation only.
		ctx.save();
		ctx.strokeStyle = '#1d1d1b';
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		for (const component of visible.components) {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			const width = component.rect.width * viewport.scale;
			const height = component.rect.height * viewport.scale;
			if (width < 10 || height < 10) continue;
			const pad = 4 * viewport.scale;
			drawKindGlyph(
				ctx,
				component.kind,
				topLeft.x + pad,
				topLeft.y + pad,
				Math.max(width - pad * 2, 4),
				Math.max(height - pad * 2, 4)
			);
		}
		ctx.restore();

		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		// Paper halo under both text lines so glyph strokes never swallow them.
		ctx.strokeStyle = '#fbf9f4';
		ctx.lineWidth = 3;
		ctx.font = '12px "Public Sans", sans-serif';
		for (const component of visible.components) {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			const width = component.rect.width * viewport.scale;
			const height = component.rect.height * viewport.scale;
			ctx.strokeText(
				component.label,
				topLeft.x + width / 2,
				topLeft.y + height / 2 - 6,
				Math.max(width - 6, 10)
			);
		}
		ctx.font = '9px "Public Sans", sans-serif';
		for (const component of visible.components) {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			const width = component.rect.width * viewport.scale;
			const height = component.rect.height * viewport.scale;
			ctx.strokeText(
				component.kind,
				topLeft.x + width / 2,
				topLeft.y + height / 2 + 8,
				Math.max(width - 6, 10)
			);
		}
		ctx.font = '12px "Public Sans", sans-serif';
		ctx.fillStyle = '#1d1d1b';
		for (const component of visible.components) {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			const width = component.rect.width * viewport.scale;
			const height = component.rect.height * viewport.scale;
			ctx.fillText(
				component.label,
				topLeft.x + width / 2,
				topLeft.y + height / 2 - 6,
				Math.max(width - 6, 10)
			);
		}
		ctx.font = '9px "Public Sans", sans-serif';
		ctx.fillStyle = '#6f6a60';
		for (const component of visible.components) {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			const width = component.rect.width * viewport.scale;
			const height = component.rect.height * viewport.scale;
			ctx.fillText(
				component.kind,
				topLeft.x + width / 2,
				topLeft.y + height / 2 + 8,
				Math.max(width - 6, 10)
			);
		}

		const pinBuckets = new Map<string, Point[]>();
		const pinPoints: Point[] = [];
		for (const component of visible.components) {
			for (const pin of component.pins) {
				const point = worldToScreen(viewport, pin.point);
				pinPoints.push(point);
				const net = pin.side === 'output' ? component.outputs[pin.name] : component.inputs[pin.name];
				const value = net ? snapshot.netValues[net] : undefined;
				const color = pinColor(value);
				const bucket = pinBuckets.get(color) ?? [];
				bucket.push(point);
				pinBuckets.set(color, bucket);
			}
		}
		// Paper punch under every pin: wires terminate at the dot edge instead
		// of running into it, and the enlarged dots stay legible on any body.
		ctx.fillStyle = '#fbf9f4';
		ctx.beginPath();
		for (const point of pinPoints) {
			ctx.moveTo(point.x + 5, point.y);
			ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
		}
		ctx.fill();
		for (const [color, points] of pinBuckets) {
			ctx.fillStyle = color;
			ctx.beginPath();
			for (const point of points) {
				ctx.moveTo(point.x + 4, point.y);
				ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
			}
			ctx.fill();
		}
		ctx.strokeStyle = '#1d1d1b';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (const point of pinPoints) {
			ctx.moveTo(point.x + 4, point.y);
			ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
		}
		ctx.stroke();

		if (marquee) {
			const topLeft = worldToScreen(viewport, { x: marquee.x, y: marquee.y });
			ctx.save();
			ctx.strokeStyle = '#1d4ed8';
			ctx.setLineDash([4, 3]);
			ctx.strokeRect(topLeft.x, topLeft.y, marquee.width * viewport.scale, marquee.height * viewport.scale);
			ctx.restore();
		}
		if (wirePreview) {
			const from = worldToScreen(viewport, wirePreview.from);
			const to = worldToScreen(viewport, wirePreview.to);
			ctx.save();
			ctx.strokeStyle = '#c0271b';
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.moveTo(from.x, from.y);
			ctx.lineTo(to.x, to.y);
			ctx.stroke();
			ctx.restore();
		}
		if (hoveredPin) {
			const found = findScenePin(hoveredPin);
			if (found) {
				drawHoveredPin(ctx, worldToScreen(viewport, found.pin.point), found.pin, found.component);
			}
		}
		// Assisted stepping: the armed next pair keeps the hover-chip
		// rendering persistently so the targets stay discoverable with no
		// pointer over them.
		const assist = snapshot.pendingAssist;
		if (assist) {
			for (const ref of [assist.output, assist.input]) {
				if (hoveredPin !== null && samePin(ref, hoveredPin)) continue;
				const found = findScenePin(ref);
				if (!found) continue;
				const screen = worldToScreen(viewport, found.pin.point);
				if (screen.x < -12 || screen.y < -12 || screen.x > size.width + 12 || screen.y > size.height + 12) {
					continue;
				}
				drawHoveredPin(ctx, screen, found.pin, found.component);
			}
		}

		const selected = visible.components.filter((component) => snapshot.selection.has(component.id));
		const nextOverlay = selected.map((component) => {
			const topLeft = worldToScreen(viewport, { x: component.rect.x, y: component.rect.y });
			return {
				id: component.id,
				left: topLeft.x,
				top: topLeft.y,
				width: component.rect.width * viewport.scale,
				height: component.rect.height * viewport.scale
			};
		});
		const signature = nextOverlay
			.map((entry) => `${entry.id}:${entry.left.toFixed(1)}:${entry.top.toFixed(1)}:${entry.width.toFixed(1)}`)
			.join('|');
		if (signature !== overlaySignature) {
			overlaySignature = signature;
			overlay = nextOverlay;
		}

		const nextAnnotations: AnnotationOverlay[] = [];
		for (const annotation of get(analogAnnotations)) {
			const world = annotationAnchor(annotation);
			if (!world) continue;
			const screen = worldToScreen(viewport, world);
			nextAnnotations.push({
				key: annotation.key,
				...(annotation.net === undefined ? {} : { net: annotation.net }),
				...(annotation.componentId === undefined ? {} : { componentId: annotation.componentId }),
				value: annotation.value,
				text: annotation.text,
				left: screen.x,
				top: screen.y
			});
		}
		const annotationSig = nextAnnotations
			.map((entry) => `${entry.key}:${entry.left.toFixed(1)}:${entry.top.toFixed(1)}:${entry.text}`)
			.join('|');
		if (annotationSig !== annotationSignature) {
			annotationSignature = annotationSig;
			annotationOverlays = nextAnnotations;
		}
	}

	let frame = 0;

	function scheduleDraw() {
		if (frame !== 0) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			draw();
		});
	}

	// Redraw on state changes rather than every frame: at ALU/CPU scale a
	// full repaint must not delay simulation-value updates.
	$effect(() => {
		void snapshot;
		void viewport;
		void size;
		void marquee;
		void wirePreview;
		void hoveredPin;
		scheduleDraw();
	});

	$effect(() => {
		void $analogAnnotations;
		scheduleDraw();
	});

	onMount(() => {
		const resizeObserver = new ResizeObserver(() => {
			if (!wrapper) return;
			size = { width: Math.max(1, wrapper.clientWidth), height: Math.max(1, wrapper.clientHeight) };
		});
		if (wrapper) resizeObserver.observe(wrapper);
		const onWindowKeyDown = (event: KeyboardEvent) => onKeyDown(event);
		window.addEventListener('keydown', onWindowKeyDown);
		scheduleDraw();
		return () => {
			if (frame !== 0) cancelAnimationFrame(frame);
			frame = 0;
			resizeObserver.disconnect();
			window.removeEventListener('keydown', onWindowKeyDown);
		};
	});
</script>

<div class="canvas-wrapper" bind:this={wrapper}>
	<canvas
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onpointerleave={onPointerLeave}
		onwheel={onWheel}
		oncontextmenu={(event) => event.preventDefault()}
	></canvas>
	<div class="overlay">
		{#each overlay as entry (entry.id)}
			<div
				class="selection"
				style:left="{entry.left}px"
				style:top="{entry.top}px"
				style:width="{entry.width}px"
				style:height="{entry.height}px"
			></div>
		{/each}
		{#each annotationOverlays as entry (entry.key)}
			<div
				class="annotation"
				class:component={entry.componentId !== undefined}
				data-testid="op-annotation"
				data-net={entry.net ?? ''}
				data-component-id={entry.componentId ?? ''}
				data-value={entry.value}
				style:left="{entry.left}px"
				style:top="{entry.top}px"
			>
				{entry.text}
			</div>
		{/each}
	</div>
	<div class="controls">
		<button type="button" onclick={() => zoomAtCenter(1.2)} aria-label="Zoom in">+</button>
		<button type="button" onclick={() => zoomAtCenter(1 / 1.2)} aria-label="Zoom out">-</button>
		<button type="button" onclick={fitView}>Fit</button>
		<span class="hint">
			{snapshot.pendingKind
				? `Click to place ${snapshot.pendingKind}`
				: snapshot.pendingAssist
					? `Next ${snapshot.pendingAssist.output.pin} → ${snapshot.pendingAssist.input.pin} (Esc cancels)`
					: snapshot.pendingWire
						? 'Click a pin to finish the wire (Esc cancels)'
						: 'Drag pins to wire, shift-click to multi-select, middle-drag to pan'}
		</span>
	</div>
</div>

<style>
	.canvas-wrapper {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 420px;
		overflow: hidden;
		background: var(--sheet-sunk);
		border: var(--rule-faint);
		border-radius: 2px;
	}

	canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: crosshair;
	}

	.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.selection {
		position: absolute;
		border: 2px solid var(--biro);
		border-radius: 2px;
		box-sizing: border-box;
		box-shadow: 0 0 0 2px var(--highlight);
	}

	.annotation {
		position: absolute;
		transform: translate(-50%, -50%);
		background: var(--highlight-soft);
		border: 1px solid var(--biro);
		border-radius: 3px;
		padding: 1px 4px;
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--biro);
		white-space: nowrap;
	}

	.annotation.component {
		border-color: var(--stamp-green);
		color: var(--stamp-green);
	}

	.controls {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: flex;
		gap: 6px;
		align-items: center;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		padding: 6px 8px;
		box-shadow: var(--shadow-sheet);
	}

	.controls button {
		min-width: 28px;
		height: 26px;
		cursor: pointer;
	}

	.hint {
		font-size: 11px;
		color: var(--ink-soft);
		max-width: 340px;
	}
</style>
