import { SUB_CIRCUIT_KIND, type SubcircuitDefinitions } from '../engine/hierarchy';
import { resolveKind } from '../engine/kinds';
import type { LogicValue } from '../engine/values';
import type { CircuitDocument, Component, ComponentId, Domain, NetId } from '../model/circuit';
import { buildSceneIndex, type SceneIndex } from './culling';
import {
	componentSize,
	pinPoint,
	rectFromPoints,
	unionRect,
	type LayoutMap,
	type Point,
	type Rect
} from './geometry';

export type SignalLevel = 'low' | 'high' | 'unknown' | 'high-z';
export type SignalPattern = 'solid' | 'hatched' | 'dashed';

export interface SignalPresentation {
	value: LogicValue;
	level: SignalLevel;
	pattern: SignalPattern;
	oscillating: boolean;
	color: string;
}

export const SIGNAL_COLORS = {
	low: '#1d1d1b',
	high: '#1f6b43',
	unknown: '#8a5a00',
	highZ: '#5b3f9e',
	oscillating: '#c0271b',
	idle: '#8a8377'
} as const;

// KTD4 presentation convention shared by the canvas, indicators, and the
// future waveform viewer: 0 solid low, 1 solid high, X hatched, Z dashed, and
// oscillating nets get a distinct flag and treatment.
export function presentSignal(value: LogicValue, oscillating = false): SignalPresentation {
	const level: SignalLevel =
		value === 0 ? 'low' : value === 1 ? 'high' : value === 'X' ? 'unknown' : 'high-z';
	const pattern: SignalPattern =
		level === 'unknown' ? 'hatched' : level === 'high-z' ? 'dashed' : 'solid';
	return {
		value,
		level,
		pattern,
		oscillating,
		color: oscillating
			? SIGNAL_COLORS.oscillating
			: level === 'high-z'
				? SIGNAL_COLORS.highZ
				: SIGNAL_COLORS[level]
	};
}

export interface ScenePin {
	name: string;
	side: 'input' | 'output';
	point: Point;
}

export interface SceneComponent {
	id: ComponentId;
	kind: string;
	label: string;
	position: Point;
	rect: Rect;
	pins: ScenePin[];
	inputs: Readonly<Record<string, NetId>>;
	outputs: Readonly<Record<string, NetId>>;
	order: number;
}

export interface SceneWire {
	id: NetId;
	netId: NetId;
	points: Point[];
	rect: Rect;
	signal: SignalPresentation | null;
	dangling: boolean;
	order: number;
}

export interface Scene {
	components: SceneComponent[];
	wires: SceneWire[];
	bounds: Rect;
	index: SceneIndex;
	componentById: ReadonlyMap<ComponentId, SceneComponent>;
	wireById: ReadonlyMap<NetId, SceneWire>;
}

export interface SceneInput {
	document: CircuitDocument;
	layout: LayoutMap;
	definitions?: SubcircuitDefinitions;
	values?: Readonly<Record<NetId, LogicValue>>;
	oscillating?: ReadonlySet<NetId>;
}

interface PinSpec {
	inputs: readonly string[];
	outputs: readonly string[];
}

function pinsOf(component: Component, definitions: SubcircuitDefinitions, domain: Domain): PinSpec {
	if (component.kind === SUB_CIRCUIT_KIND) {
		const name = component.params?.['definition'];
		const definition = typeof name === 'string' ? definitions[name] : undefined;
		if (definition) {
			return { inputs: Object.keys(definition.inputs), outputs: Object.keys(definition.outputs) };
		}
		return { inputs: [], outputs: [] };
	}
	try {
		return resolveKind(component.kind, domain, component.params) ?? { inputs: [], outputs: [] };
	} catch {
		return { inputs: [], outputs: [] };
	}
}

export interface Endpoint {
	componentId: ComponentId;
	point: Point;
	side: 'input' | 'output';
}

function stubPoint(point: Point, side: 'input' | 'output'): Point {
	return { x: point.x + (side === 'output' ? 10 : -10), y: point.y };
}

// Orthogonal wire routing: each consumer pin runs to the shared driver pin
// through a mid-point trunk. A net with a single endpoint renders as a short
// dangling stub instead of a wire, which is what makes dangling wires visible.
export function routeWire(endpoints: readonly Endpoint[]): Point[] {
	if (endpoints.length === 0) return [];
	if (endpoints.length === 1) {
		const only = endpoints[0];
		return [only.point, stubPoint(only.point, only.side)];
	}
	const driver = endpoints.find((endpoint) => endpoint.side === 'output') ?? endpoints[0];
	const driverStub = stubPoint(driver.point, 'output');
	const points: Point[] = [];
	for (const endpoint of endpoints) {
		if (endpoint === driver) continue;
		const targetStub = stubPoint(endpoint.point, endpoint.side);
		const trunkX = (targetStub.x + driverStub.x) / 2;
		points.push(
			endpoint.point,
			targetStub,
			{ x: trunkX, y: targetStub.y },
			{ x: trunkX, y: driverStub.y },
			driverStub,
			driver.point
		);
	}
	if (points.length === 0) {
		points.push(driver.point, driverStub);
	}
	return points;
}

export function buildScene(input: SceneInput): Scene {
	const definitions = input.definitions ?? {};
	const domain: Domain = input.document.domain ?? 'logic';
	const components: SceneComponent[] = [];
	const endpointsByNet = new Map<NetId, Endpoint[]>();

	let componentOrder = 0;
	for (const component of input.document.components) {
		const layoutEntry = input.layout[component.id];
		const position = layoutEntry?.position ?? { x: 0, y: 0 };
		const label = layoutEntry?.label ?? component.id;
		const pins = pinsOf(component, definitions, domain);
		const size = componentSize(label, pins.inputs.length, pins.outputs.length);
		const rect: Rect = { x: position.x, y: position.y, width: size.width, height: size.height };
		const scenePins: ScenePin[] = [];
		for (let index = 0; index < pins.inputs.length; index++) {
			const point = pinPoint(rect, 'input', index, pins.inputs.length);
			if (!point) continue;
			const name = pins.inputs[index];
			scenePins.push({ name, side: 'input', point });
			const net = component.inputs[name];
			if (net !== undefined) {
				const list = endpointsByNet.get(net);
				const endpoint: Endpoint = { componentId: component.id, point, side: 'input' };
				if (list) list.push(endpoint);
				else endpointsByNet.set(net, [endpoint]);
			}
		}
		for (let index = 0; index < pins.outputs.length; index++) {
			const point = pinPoint(rect, 'output', index, pins.outputs.length);
			if (!point) continue;
			const name = pins.outputs[index];
			scenePins.push({ name, side: 'output', point });
			const net = component.outputs[name];
			if (net !== undefined) {
				const list = endpointsByNet.get(net);
				const endpoint: Endpoint = { componentId: component.id, point, side: 'output' };
				if (list) list.push(endpoint);
				else endpointsByNet.set(net, [endpoint]);
			}
		}
		components.push({
			id: component.id,
			kind: component.kind,
			label,
			position,
			rect,
			pins: scenePins,
			inputs: component.inputs,
			outputs: component.outputs,
			order: componentOrder
		});
		componentOrder += 1;
	}

	const wires: SceneWire[] = [];
	let wireOrder = 0;
	for (const [net, endpoints] of endpointsByNet) {
		const points = routeWire(endpoints);
		if (points.length === 0) continue;
		const value = input.values?.[net];
		const signal =
			value === undefined ? null : presentSignal(value, input.oscillating?.has(net) ?? false);
		wires.push({
			id: net,
			netId: net,
			points,
			rect: rectFromPoints(points),
			signal,
			dangling: endpoints.length === 1,
			order: wireOrder
		});
		wireOrder += 1;
	}

	let bounds: Rect | null = null;
	for (const component of components) {
		bounds = bounds ? unionRect(bounds, component.rect) : component.rect;
	}
	for (const wire of wires) {
		bounds = bounds ? unionRect(bounds, wire.rect) : wire.rect;
	}

	const sceneBase = {
		components,
		wires,
		bounds: bounds ?? { x: 0, y: 0, width: 0, height: 0 }
	};
	return {
		...sceneBase,
		index: buildSceneIndex(sceneBase),
		componentById: new Map(components.map((component) => [component.id, component])),
		wireById: new Map(wires.map((wire) => [wire.netId, wire]))
	};
}
