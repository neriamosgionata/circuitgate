import { SUB_CIRCUIT_KIND, flatten, type SubcircuitDefinitions } from '../engine/hierarchy';
import { defaultAnalysisParams } from '../engine/analog/netlist';
import { defaultParamsForKind as defaultAnalogParamsForKind } from '../engine/analog/primitives';
import {
	MAX_WIDTH,
	defaultParamsForKind as defaultLogicParamsForKind,
	kindExistsInOtherDomain,
	resolveKind
} from '../engine/kinds';
import { primitiveKinds } from '../engine/primitives';
import type { LogicValue } from '../engine/values';
import type {
	AnalogAnalysis,
	AnalogAnalysisKind,
	AnalogModel,
	CircuitDocument,
	Component,
	ComponentId,
	Domain,
	NetId
} from '../model/circuit';
import { MAX_MODEL_TEXT_LENGTH } from '../model/schema';
import {
	screenToWorld,
	snapPoint,
	type ComponentLayout,
	type LayoutMap,
	type Point,
	type Rect,
	type Viewport
} from '../render/geometry';
import {
	emptySelection,
	movePositions,
	removeComponents,
	removeLayoutEntries,
	selectInRect,
	selectionBounds,
	toggleSelected,
	withSelection,
	withoutSelected,
	type PinSpec,
	type Selection
} from './selection';

export interface PinRef {
	componentId: ComponentId;
	pin: string;
	side: 'input' | 'output';
}

export type Failure = { ok: false; error: string };
export type Result<T> = { ok: true; value: T } | Failure;
export type UnitResult = { ok: true } | Failure;

export interface BoundaryCandidate {
	netId: NetId;
	direction: 'input' | 'output';
	name: string;
	insidePins: readonly PinRef[];
	outsidePins: readonly PinRef[];
}

export interface PackagingDraft {
	componentIds: readonly ComponentId[];
	candidates: readonly BoundaryCandidate[];
	inputs: Readonly<Record<string, NetId>>;
	outputs: Readonly<Record<string, NetId>>;
}

export interface EditorSnapshot {
	circuit: CircuitDocument;
	definitions: SubcircuitDefinitions;
	layouts: Readonly<Record<string, LayoutMap>>;
	domain: Domain;
	models: readonly AnalogModel[];
	analyses: readonly AnalogAnalysis[];
	path: readonly string[];
	document: CircuitDocument;
	layout: LayoutMap;
	selection: Selection;
	pendingKind: string | null;
	pendingWire: PinRef | null;
	packaging: PackagingDraft | null;
	netValues: Readonly<Record<NetId, LogicValue>>;
	oscillatingNets: ReadonlySet<NetId>;
	revision: number;
}

export interface CircuitStoreOptions {
	circuit?: CircuitDocument;
	definitions?: SubcircuitDefinitions;
	layouts?: Readonly<Record<string, LayoutMap>>;
	domain?: Domain;
	models?: readonly AnalogModel[];
	analyses?: readonly AnalogAnalysis[];
}

export type StoreListener = (snapshot: EditorSnapshot) => void;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function emptyDocument(): CircuitDocument {
	return { schemaVersion: 1, components: [] };
}

function rootCircuit(options: CircuitStoreOptions): CircuitDocument {
	const document: CircuitDocument = { ...(options.circuit ?? emptyDocument()) };
	if (options.domain !== undefined) document.domain = options.domain;
	if (options.models !== undefined) document.models = [...options.models];
	if (options.analyses !== undefined) document.analyses = options.analyses.map((entry) => ({ ...entry }));
	return document;
}

function cloneLayoutMap(layout: LayoutMap | undefined): Record<string, ComponentLayout> {
	const copy: Record<string, ComponentLayout> = {};
	if (!layout) return copy;
	for (const [id, entry] of Object.entries(layout)) {
		copy[id] =
			entry.label === undefined
				? { position: { ...entry.position } }
				: { position: { ...entry.position }, label: entry.label };
	}
	return copy;
}

function layoutKey(path: readonly string[]): string {
	return path.join('/');
}

function sanitizePinName(netId: string, fallbackIndex: number): string {
	const cleaned = netId.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '');
	return cleaned.length > 0 ? cleaned : `pin${fallbackIndex}`;
}

function uniquePinName(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	let suffix = 1;
	while (taken.has(`${base}_${suffix}`)) suffix += 1;
	return `${base}_${suffix}`;
}

// In-memory editor state: the semantic circuit document plus the per-definition
// layout layer (KTD7 keeps layout separate from semantics). Every mutation
// produces new immutable snapshots and notifies subscribers.
export class CircuitEditorStore {
	private circuit: CircuitDocument;
	private definitions: SubcircuitDefinitions;
	private layouts: Record<string, LayoutMap>;
	private path: string[] = [];
	private selection: Selection = emptySelection();
	private pendingKind: string | null = null;
	private pendingWire: PinRef | null = null;
	private packaging: PackagingDraft | null = null;
	private netValues: Record<NetId, LogicValue> = {};
	private oscillatingNets: Set<NetId> = new Set();
	private revision = 0;
	private readonly listeners = new Set<StoreListener>();
	private readonly usedComponentIds = new Set<ComponentId>();
	private componentCounter = 0;
	private instanceCounter = 0;
	private netCounter = 0;

	constructor(options: CircuitStoreOptions = {}) {
		this.circuit = rootCircuit(options);
		this.definitions = options.definitions ?? {};
		this.layouts = {};
		if (options.layouts) {
			for (const [key, value] of Object.entries(options.layouts)) {
				this.layouts[key] = cloneLayoutMap(value);
			}
		}
		if (!this.layouts['']) this.layouts[''] = {};
		this.reindexIds();
	}

	get snapshot(): EditorSnapshot {
		const path = [...this.path];
		return {
			circuit: this.circuit,
			definitions: this.definitions,
			layouts: this.layouts,
			domain: this.circuit.domain ?? 'logic',
			models: this.circuit.models ?? [],
			analyses: this.circuit.analyses ?? [],
			path,
			document: this.currentDocument(),
			layout: this.layoutFor(path),
			selection: this.selection,
			pendingKind: this.pendingKind,
			pendingWire: this.pendingWire,
			packaging: this.packaging,
			netValues: this.netValues,
			oscillatingNets: this.oscillatingNets,
			revision: this.revision
		};
	}

	subscribe(listener: StoreListener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => {
			this.listeners.delete(listener);
		};
	}

	loadDocument(options: CircuitStoreOptions = {}): void {
		this.circuit = rootCircuit(options);
		this.definitions = options.definitions ?? {};
		this.layouts = {};
		if (options.layouts) {
			for (const [key, value] of Object.entries(options.layouts)) {
				this.layouts[key] = cloneLayoutMap(value);
			}
		}
		if (!this.layouts['']) this.layouts[''] = {};
		this.path = [];
		this.selection = emptySelection();
		this.pendingKind = null;
		this.pendingWire = null;
		this.packaging = null;
		this.netValues = {};
		this.oscillatingNets = new Set();
		this.usedComponentIds.clear();
		this.componentCounter = 0;
		this.instanceCounter = 0;
		this.netCounter = 0;
		this.reindexIds();
		this.emit();
	}

	private emit(): void {
		this.revision += 1;
		const snapshot = this.snapshot;
		for (const listener of this.listeners) listener(snapshot);
	}

	private currentDocument(): CircuitDocument {
		if (this.path.length === 0) return this.circuit;
		const name = this.path[this.path.length - 1];
		return this.definitions[name]?.document ?? emptyDocument();
	}

	private layoutFor(path: readonly string[]): LayoutMap {
		return this.layouts[layoutKey(path)] ?? {};
	}

	private updateCurrentLayout(next: LayoutMap): void {
		this.layouts = { ...this.layouts, [layoutKey(this.path)]: next };
	}

	private updateCurrentDocument(next: CircuitDocument): void {
		if (this.path.length === 0) {
			this.circuit = next;
			return;
		}
		const name = this.path[this.path.length - 1];
		const definition = this.definitions[name];
		if (!definition) return;
		this.definitions = { ...this.definitions, [name]: { ...definition, document: next } };
	}

	private reindexIds(): void {
		const documents = [this.circuit, ...Object.values(this.definitions).map((def) => def.document)];
		for (const document of documents) {
			for (const component of document.components) {
				this.usedComponentIds.add(component.id);
				const match = /^[A-Za-z]+(\d+)$/.exec(component.id);
				if (match) this.componentCounter = Math.max(this.componentCounter, Number(match[1]));
			}
		}
	}

	private nextComponentId(): ComponentId {
		let id = `c${this.componentCounter + 1}`;
		while (this.usedComponentIds.has(id)) {
			this.componentCounter += 1;
			id = `c${this.componentCounter + 1}`;
		}
		this.componentCounter += 1;
		this.usedComponentIds.add(id);
		return id;
	}

	private nextInstanceId(): ComponentId {
		let id = `pkg${this.instanceCounter + 1}`;
		while (this.usedComponentIds.has(id)) {
			this.instanceCounter += 1;
			id = `pkg${this.instanceCounter + 1}`;
		}
		this.instanceCounter += 1;
		this.usedComponentIds.add(id);
		return id;
	}

	private usedNets(): Set<NetId> {
		const nets = new Set<NetId>();
		const documents = [this.circuit, ...Object.values(this.definitions).map((def) => def.document)];
		for (const document of documents) {
			for (const component of document.components) {
				for (const net of Object.values(component.inputs)) nets.add(net);
				for (const net of Object.values(component.outputs)) nets.add(net);
			}
		}
		return nets;
	}

	private nextNetId(): NetId {
		const used = this.usedNets();
		let id = `n${this.netCounter + 1}`;
		while (used.has(id)) {
			this.netCounter += 1;
			id = `n${this.netCounter + 1}`;
		}
		this.netCounter += 1;
		return id;
	}

	// Subcircuit definitions are logic-only in this slice, so the domain
	// inside a definition is always logic.
	private domain(): Domain {
		return this.path.length === 0 ? this.circuit.domain ?? 'logic' : 'logic';
	}

	private pinsForKind(kind: string, params?: Record<string, unknown>): PinSpec | null {
		if (kind === SUB_CIRCUIT_KIND) return null;
		try {
			return this.resolvePinsForKind(kind, params);
		} catch {
			return null;
		}
	}

	private resolvePinsForKind(kind: string, params?: Record<string, unknown>): PinSpec | null {
		if (kind === SUB_CIRCUIT_KIND) return null;
		return resolveKind(kind, this.domain(), params);
	}

	private pinsFor(component: Component): PinSpec | null {
		if (component.kind === SUB_CIRCUIT_KIND) {
			const name = component.params?.['definition'];
			const definition = typeof name === 'string' ? this.definitions[name] : undefined;
			return definition
				? { inputs: Object.keys(definition.inputs), outputs: Object.keys(definition.outputs) }
				: null;
		}
		return this.pinsForKind(component.kind, component.params);
	}

	private findComponent(id: ComponentId): Component | undefined {
		return this.currentDocument().components.find((component) => component.id === id);
	}

	private pinExists(pin: PinRef): boolean {
		const component = this.findComponent(pin.componentId);
		if (!component) return false;
		const pins = this.pinsFor(component);
		if (!pins) return false;
		const list = pin.side === 'input' ? pins.inputs : pins.outputs;
		return list.includes(pin.pin);
	}

	private netForPin(pin: PinRef): NetId | undefined {
		const component = this.findComponent(pin.componentId);
		if (!component) return undefined;
		return (pin.side === 'input' ? component.inputs : component.outputs)[pin.pin];
	}

	private setPinNet(pin: PinRef, net: NetId | undefined): void {
		const document = this.currentDocument();
		const next: CircuitDocument = {
			...document,
			components: document.components.map((component) => {
				if (component.id !== pin.componentId) return component;
				if (pin.side === 'input') {
					const inputs = { ...component.inputs };
					if (net === undefined) delete inputs[pin.pin];
					else inputs[pin.pin] = net;
					return { ...component, inputs };
				}
				const outputs = { ...component.outputs };
				if (net === undefined) delete outputs[pin.pin];
				else outputs[pin.pin] = net;
				return { ...component, outputs };
			})
		};
		this.updateCurrentDocument(next);
	}

	// ---- selection ----------------------------------------------------------

	setSelection(ids: Iterable<ComponentId>): void {
		this.selection = withSelection(this.selection, ids);
		this.emit();
	}

	toggleSelection(id: ComponentId): void {
		this.selection = toggleSelected(this.selection, id);
		this.emit();
	}

	clearSelection(): void {
		this.selection = emptySelection();
		this.emit();
	}

	selectInRect(rect: Rect): Selection {
		this.selection = selectInRect(
			this.currentDocument(),
			this.layoutFor(this.path),
			(component) => this.pinsFor(component) ?? { inputs: [], outputs: [] },
			rect
		);
		this.emit();
		return this.selection;
	}

	// ---- placement and movement --------------------------------------------

	beginPlacement(kind: string): UnitResult {
		if (!this.pinsForKind(kind)) return { ok: false, error: 'unknown-kind' };
		this.pendingKind = kind;
		this.emit();
		return { ok: true };
	}

	cancelPlacement(): void {
		if (this.pendingKind === null) return;
		this.pendingKind = null;
		this.emit();
	}

	placeComponent(kind: string, position: Point, params?: Record<string, unknown>): Result<Component> {
		const effectiveParams =
			params ?? defaultLogicParamsForKind(kind) ?? defaultAnalogParamsForKind(kind) ?? undefined;
		let pins: PinSpec | null;
		try {
			pins = this.resolvePinsForKind(kind, effectiveParams);
		} catch {
			return { ok: false, error: 'invalid-param' };
		}
		if (!pins) return { ok: false, error: 'unknown-kind' };
		const id = this.nextComponentId();
		const component: Component = {
			id,
			kind,
			inputs: {},
			outputs: {}
		};
		const defaults =
			effectiveParams ?? (kind === 'clock' ? { polarity: 'rising' } : undefined);
		if (defaults !== undefined) component.params = { ...defaults };
		const document = this.currentDocument();
		this.updateCurrentDocument({
			...document,
			components: [...document.components, component]
		});
		const layout = cloneLayoutMap(this.layoutFor(this.path));
		layout[id] = { position: snapPoint(position) };
		this.updateCurrentLayout(layout);
		this.emit();
		return { ok: true, value: component };
	}

	placeComponentAtScreen(kind: string, screenPoint: Point, viewport: Viewport): Result<Component> {
		const world = screenToWorld(viewport, screenPoint);
		return this.placeComponent(kind, snapPoint(world));
	}

	moveSelectionBy(delta: Point): void {
		if (this.selection.size === 0) return;
		this.updateCurrentLayout(
			movePositions(this.layoutFor(this.path), this.selection, delta)
		);
		this.emit();
	}

	setComponentPosition(id: ComponentId, position: Point): UnitResult {
		if (!this.findComponent(id)) return { ok: false, error: 'unknown-component' };
		const layout = cloneLayoutMap(this.layoutFor(this.path));
		const existing = layout[id];
		layout[id] =
			existing?.label === undefined
				? { position: snapPoint(position) }
				: { position: snapPoint(position), label: existing.label };
		this.updateCurrentLayout(layout);
		this.emit();
		return { ok: true };
	}

	setPositions(positions: Readonly<Record<ComponentId, Point>>): void {
		const layout = cloneLayoutMap(this.layoutFor(this.path));
		for (const [id, position] of Object.entries(positions)) {
			if (!this.findComponent(id)) continue;
			const existing = layout[id];
			layout[id] =
				existing?.label === undefined
					? { position: snapPoint(position) }
					: { position: snapPoint(position), label: existing.label };
		}
		this.updateCurrentLayout(layout);
		this.emit();
	}

	deleteSelection(): number {
		const document = this.currentDocument();
		const count = document.components.filter((component) => this.selection.has(component.id)).length;
		if (count === 0) return 0;
		this.updateCurrentDocument(removeComponents(document, this.selection));
		this.updateCurrentLayout(removeLayoutEntries(this.layoutFor(this.path), this.selection));
		this.selection = emptySelection();
		this.emit();
		return count;
	}

	selectionBounds(): Rect | null {
		return selectionBounds(
			this.currentDocument(),
			this.layoutFor(this.path),
			(component) => this.pinsFor(component) ?? { inputs: [], outputs: [] },
			this.selection
		);
	}

	// ---- wiring -------------------------------------------------------------

	beginWire(pin: PinRef): UnitResult {
		if (!this.pinExists(pin)) return { ok: false, error: 'unknown-pin' };
		if (this.pendingWire) return { ok: false, error: 'wire-in-progress' };
		this.pendingWire = pin;
		this.emit();
		return { ok: true };
	}

	completeWire(target: PinRef): Result<NetId> {
		const pending = this.pendingWire;
		if (!pending) return { ok: false, error: 'no-pending-wire' };
		if (!this.pinExists(target)) return { ok: false, error: 'unknown-pin' };
		if (pending.componentId === target.componentId && pending.pin === target.pin) {
			return { ok: false, error: 'self-connection' };
		}
		if (pending.side === target.side) {
			return { ok: false, error: pending.side === 'input' ? 'input-to-input' : 'output-to-output' };
		}
		const pendingNet = this.netForPin(pending);
		const targetNet = this.netForPin(target);
		let net: NetId;
		if (pendingNet !== undefined && targetNet !== undefined) {
			if (pendingNet === targetNet) {
				net = pendingNet;
			} else {
				net = this.mergeNets(pendingNet, targetNet);
			}
		} else if (pendingNet !== undefined) {
			net = pendingNet;
			this.setPinNet(target, net);
		} else if (targetNet !== undefined) {
			net = targetNet;
			this.setPinNet(pending, net);
		} else {
			net = this.nextNetId();
			this.setPinNet(pending, net);
			this.setPinNet(target, net);
		}
		this.pendingWire = null;
		this.emit();
		return { ok: true, value: net };
	}

	endWire(target: PinRef | null): Result<NetId> {
		if (!target) {
			const hadPending = this.pendingWire !== null;
			this.pendingWire = null;
			if (hadPending) this.emit();
			return { ok: false, error: hadPending ? 'dangling-wire' : 'no-pending-wire' };
		}
		return this.completeWire(target);
	}

	cancelWire(): void {
		if (this.pendingWire === null) return;
		this.pendingWire = null;
		this.emit();
	}

	// Direct pin-to-net assignment, used when completing partially wired
	// instances; the UI never calls this for dangling drops.
	assignPin(pin: PinRef, net: NetId): UnitResult {
		if (!this.pinExists(pin)) return { ok: false, error: 'unknown-pin' };
		if (net.length === 0) return { ok: false, error: 'empty-net' };
		this.setPinNet(pin, net);
		this.emit();
		return { ok: true };
	}

	private mergeNets(keep: NetId, merge: NetId): NetId {
		const document = this.currentDocument();
		const components = document.components.map((component) => {
			const replace = (record: Record<string, NetId>): Record<string, NetId> => {
				let changed = false;
				const next: Record<string, NetId> = { ...record };
				for (const [pin, net] of Object.entries(record)) {
					if (net === merge) {
						next[pin] = keep;
						changed = true;
					}
				}
				return changed ? next : record;
			};
			const inputs = replace(component.inputs);
			const outputs = replace(component.outputs);
			if (inputs === component.inputs && outputs === component.outputs) return component;
			return { ...component, inputs, outputs };
		});
		this.updateCurrentDocument({ ...document, components });
		return keep;
	}

	// ---- properties ---------------------------------------------------------

	setLabel(id: ComponentId, label: string): UnitResult {
		if (!this.findComponent(id)) return { ok: false, error: 'unknown-component' };
		const layout = cloneLayoutMap(this.layoutFor(this.path));
		const entry = layout[id];
		const position = entry?.position ?? { x: 0, y: 0 };
		const trimmed = label.trim();
		layout[id] = trimmed.length === 0 ? { position } : { position, label: trimmed };
		this.updateCurrentLayout(layout);
		this.emit();
		return { ok: true };
	}

	setParam(id: ComponentId, key: string, value: unknown): Result<number> {
		const component = this.findComponent(id);
		if (!component) return { ok: false, error: 'unknown-component' };
		if (key.length === 0) return { ok: false, error: 'empty-param' };
		if (key === 'width' || key === 'wordBits') {
			if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_WIDTH) {
				return { ok: false, error: 'invalid-width' };
			}
		}
		if (key === 'addressBits') {
			if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 30) {
				return { ok: false, error: 'invalid-width' };
			}
		}
		const params = { ...(component.params ?? {}), [key]: value };
		return this.applyParams(id, params);
	}

	setComponentKind(id: ComponentId, kind: string): UnitResult {
		const component = this.findComponent(id);
		if (!component) return { ok: false, error: 'unknown-component' };
		let pins: PinSpec | null;
		try {
			pins = this.resolvePinsForKind(kind, component.params);
		} catch {
			return { ok: false, error: 'invalid-param' };
		}
		if (!pins) {
			return {
				ok: false,
				error: kindExistsInOtherDomain(kind, this.domain()) ? 'domain-mismatch' : 'unknown-kind'
			};
		}
		const keep = (record: Record<string, NetId>, names: readonly string[]): Record<string, NetId> => {
			const next: Record<string, NetId> = {};
			for (const name of names) {
				const net = record[name];
				if (net !== undefined) next[name] = net;
			}
			return next;
		};
		this.replaceComponent({
			...component,
			kind,
			inputs: keep(component.inputs, pins.inputs),
			outputs: keep(component.outputs, pins.outputs)
		});
		this.emit();
		return { ok: true };
	}

	setBusWidth(id: ComponentId, width: number): Result<number> {
		const component = this.findComponent(id);
		if (!component) return { ok: false, error: 'unknown-component' };
		if (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH) {
			return { ok: false, error: 'invalid-width' };
		}
		const kind = component.kind;
		const base: Record<string, unknown> = { ...(component.params ?? {}) };
		let params: Record<string, unknown>;
		if (kind === 'rippleCarryAdder' || kind === 'magnitudeComparator' || kind === 'register') {
			params = { ...base, width };
			delete params['wordBits'];
			delete params['addressBits'];
		} else if (kind === 'ram' || kind === 'registerFile') {
			// KTD5: addressBits and wordBits stay independent — never collapse
			// into a single width value. The width control drives wordBits only.
			params = { ...base, wordBits: width };
			delete params['width'];
		} else if (kind === 'rom') {
			// ROM depth derives from contents length and is never directly edited.
			params = { ...base, wordBits: width };
			delete params['width'];
		} else {
			params = { ...base, width };
		}
		return this.applyParams(id, params);
	}

	// Single mutation path for parameter edits (KTD1/KTD5): re-derive pins
	// from kind+params, keep nets on same-named surviving pins, drop vanished
	// pins' nets, and return the dropped-net count.
	private applyParams(id: ComponentId, newParams: Record<string, unknown>): Result<number> {
		const component = this.findComponent(id);
		if (!component) return { ok: false, error: 'unknown-component' };
		let pins: PinSpec | null;
		try {
			pins = this.resolvePinsForKind(component.kind, newParams);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/width|addressBits|wordBits/i.test(message)) {
				return { ok: false, error: 'invalid-width' };
			}
			return { ok: false, error: 'invalid-param' };
		}
		if (!pins) return { ok: false, error: 'unknown-kind' };
		const prune = (
			record: Record<string, NetId>,
			names: readonly string[]
		): { next: Record<string, NetId>; dropped: number } => {
			const next: Record<string, NetId> = {};
			let dropped = 0;
			for (const [name, net] of Object.entries(record)) {
				if ((names as readonly string[]).includes(name)) next[name] = net;
				else dropped += 1;
			}
			return { next, dropped };
		};
		const prunedInputs = prune(component.inputs, pins.inputs);
		const prunedOutputs = prune(component.outputs, pins.outputs);
		const dropped = prunedInputs.dropped + prunedOutputs.dropped;
		this.replaceComponent({
			...component,
			params: { ...newParams },
			inputs: prunedInputs.next,
			outputs: prunedOutputs.next
		});
		this.emit();
		return { ok: true, value: dropped };
	}

	setClockPolarity(id: ComponentId, polarity: 'rising' | 'falling'): UnitResult {
		const component = this.findComponent(id);
		if (!component) return { ok: false, error: 'unknown-component' };
		if (component.kind !== 'clock') return { ok: false, error: 'not-a-clock' };
		this.replaceComponent({ ...component, params: { ...(component.params ?? {}), polarity } });
		this.emit();
		return { ok: true };
	}

	private replaceComponent(next: Component): void {
		const document = this.currentDocument();
		this.updateCurrentDocument({
			...document,
			components: document.components.map((component) =>
				component.id === next.id ? next : component
			)
		});
	}

	// ---- analysis configuration ---------------------------------------------

	private analysisEntries(): AnalogAnalysis[] {
		return [...(this.currentDocument().analyses ?? [])];
	}

	private nextAnalysisId(taken: ReadonlySet<string>): string {
		let index = this.counterSeed(taken) + 1;
		let id = `a${index}`;
		while (taken.has(id)) {
			index += 1;
			id = `a${index}`;
		}
		return id;
	}

	private counterSeed(taken: ReadonlySet<string>): number {
		let highest = 0;
		for (const id of taken) {
			const match = /^a(\d+)$/.exec(id);
			if (match) highest = Math.max(highest, Number(match[1]));
		}
		return highest;
	}

	addAnalysis(kind: AnalogAnalysisKind, params: Record<string, unknown> = {}): Result<AnalogAnalysis> {
		const document = this.currentDocument();
		const entries = this.analysisEntries();
		const taken = new Set(entries.map((entry) => entry.id));
		const entry: AnalogAnalysis = {
			id: this.nextAnalysisId(taken),
			kind,
			params: { ...defaultAnalysisParams(kind), ...params }
		};
		this.updateCurrentDocument({ ...document, analyses: [...entries, entry] });
		this.emit();
		return { ok: true, value: entry };
	}

	updateAnalysis(id: string, params: Record<string, unknown>): UnitResult {
		const document = this.currentDocument();
		const entries = this.analysisEntries();
		if (!entries.some((entry) => entry.id === id)) return { ok: false, error: 'unknown-analysis' };
		this.updateCurrentDocument({
			...document,
			analyses: entries.map((entry) => (entry.id === id ? { ...entry, params: { ...params } } : entry))
		});
		this.emit();
		return { ok: true };
	}

	removeAnalysis(id: string): boolean {
		const document = this.currentDocument();
		const entries = this.analysisEntries();
		const remaining = entries.filter((entry) => entry.id !== id);
		if (remaining.length === entries.length) return false;
		this.updateCurrentDocument({ ...document, analyses: remaining });
		this.emit();
		return true;
	}

	duplicateAnalysis(id: string): Result<AnalogAnalysis> {
		const document = this.currentDocument();
		const entries = this.analysisEntries();
		const source = entries.find((entry) => entry.id === id);
		if (!source) return { ok: false, error: 'unknown-analysis' };
		const taken = new Set(entries.map((entry) => entry.id));
		const params = structuredClone(source.params ?? {});
		if (source.kind === 'meas' && typeof params['name'] === 'string' && params['name'].length > 0) {
			params['name'] = `${params['name']} copy`;
		}
		const entry: AnalogAnalysis = { id: this.nextAnalysisId(taken), kind: source.kind, params };
		this.updateCurrentDocument({ ...document, analyses: [...entries, entry] });
		this.emit();
		return { ok: true, value: entry };
	}

	// ---- imported models ----------------------------------------------------

	addModel(model: AnalogModel): Result<AnalogModel> {
		if (typeof model.name !== 'string' || model.name.trim().length === 0) {
			return { ok: false, error: 'model name is required' };
		}
		if (typeof model.source !== 'string' || model.source.length === 0) {
			return { ok: false, error: 'model source is required' };
		}
		if (model.source.length > MAX_MODEL_TEXT_LENGTH) {
			return { ok: false, error: `model source exceeds ${MAX_MODEL_TEXT_LENGTH} characters` };
		}
		const models = this.circuit.models ?? [];
		if (models.some((entry) => entry.name === model.name)) {
			return { ok: false, error: `a model named ${model.name} is already stored` };
		}
		const stored: AnalogModel = { ...model };
		this.circuit = { ...this.circuit, models: [...models, stored] };
		this.emit();
		return { ok: true, value: { ...stored } };
	}

	// ---- signal values (rendered now, driven by the sim worker in U5) -------

	setNetValue(net: NetId, value: LogicValue, oscillating = false): void {
		this.netValues = { ...this.netValues, [net]: value };
		const next = new Set(this.oscillatingNets);
		if (oscillating) next.add(net);
		else next.delete(net);
		this.oscillatingNets = next;
		this.emit();
	}

	applyNetValues(
		changes: ReadonlyArray<{ net: NetId; value: LogicValue; oscillating: boolean }>
	): void {
		if (changes.length === 0) return;
		const values = { ...this.netValues };
		const oscillating = new Set(this.oscillatingNets);
		for (const change of changes) {
			values[change.net] = change.value;
			if (change.oscillating) oscillating.add(change.net);
			else oscillating.delete(change.net);
		}
		this.netValues = values;
		this.oscillatingNets = oscillating;
		this.emit();
	}

	clearNetValues(): void {
		this.netValues = {};
		this.oscillatingNets = new Set();
		this.emit();
	}

	// ---- subcircuit authoring ----------------------------------------------

	beginPackaging(): Result<PackagingDraft> {
		if (this.selection.size === 0) return { ok: false, error: 'empty-selection' };
		const document = this.currentDocument();
		const inside = new Map<NetId, PinRef[]>();
		const outside = new Map<NetId, PinRef[]>();
		for (const component of document.components) {
			const pins = this.pinsFor(component);
			if (!pins) continue;
			const selected = this.selection.has(component.id);
			for (const pin of pins.inputs) {
				const net = component.inputs[pin];
				if (net === undefined) continue;
				const list = (selected ? inside : outside).get(net);
				const ref: PinRef = { componentId: component.id, pin, side: 'input' };
				if (list) list.push(ref);
				else (selected ? inside : outside).set(net, [ref]);
			}
			for (const pin of pins.outputs) {
				const net = component.outputs[pin];
				if (net === undefined) continue;
				const list = (selected ? inside : outside).get(net);
				const ref: PinRef = { componentId: component.id, pin, side: 'output' };
				if (list) list.push(ref);
				else (selected ? inside : outside).set(net, [ref]);
			}
		}
		const conflicts: NetId[] = [];
		const candidates: BoundaryCandidate[] = [];
		const takenNames = new Set<string>();
		let index = 0;
		for (const [net, insidePins] of inside) {
			const outsidePins = outside.get(net);
			if (!outsidePins || outsidePins.length === 0) continue;
			const internalDriver = insidePins.some((pin) => pin.side === 'output');
			const externalDriver = outsidePins.some((pin) => pin.side === 'output');
			if (internalDriver && externalDriver) {
				conflicts.push(net);
				continue;
			}
			const direction: 'input' | 'output' = internalDriver ? 'output' : 'input';
			const name = uniquePinName(sanitizePinName(net, index), takenNames);
			takenNames.add(name);
			candidates.push({ netId: net, direction, name, insidePins, outsidePins });
			index += 1;
		}
		if (conflicts.length > 0) {
			return { ok: false, error: `multiple-drivers:${conflicts.join(',')}` };
		}
		if (candidates.length === 0) return { ok: false, error: 'no-boundary-pins' };
		const inputs: Record<string, NetId> = {};
		const outputs: Record<string, NetId> = {};
		for (const candidate of candidates) {
			if (candidate.direction === 'input') inputs[candidate.name] = candidate.netId;
			else outputs[candidate.name] = candidate.netId;
		}
		this.packaging = {
			componentIds: [...this.selection],
			candidates,
			inputs,
			outputs
		};
		this.emit();
		return { ok: true, value: this.packaging };
	}

	renamePackagingPin(netId: NetId, name: string): UnitResult {
		const draft = this.packaging;
		if (!draft) return { ok: false, error: 'no-packaging' };
		if (!IDENTIFIER.test(name)) return { ok: false, error: 'invalid-pin-name' };
		const inInputs = Object.prototype.hasOwnProperty.call(draft.inputs, name);
		const inOutputs = Object.prototype.hasOwnProperty.call(draft.outputs, name);
		if ((inInputs && draft.inputs[name] !== netId) || (inOutputs && draft.outputs[name] !== netId)) {
			return { ok: false, error: 'duplicate-pin-name' };
		}
		const inputs: Record<string, NetId> = {};
		for (const [pin, target] of Object.entries(draft.inputs)) {
			if (target === netId) inputs[name] = target;
			else inputs[pin] = target;
		}
		const outputs: Record<string, NetId> = {};
		for (const [pin, target] of Object.entries(draft.outputs)) {
			if (target === netId) outputs[name] = target;
			else outputs[pin] = target;
		}
		this.packaging = { ...draft, inputs, outputs };
		this.emit();
		return { ok: true };
	}

	cancelPackaging(): void {
		if (!this.packaging) return;
		this.packaging = null;
		this.emit();
	}

	confirmPackage(name: string): Result<ComponentId> {
		const draft = this.packaging;
		if (!draft) return { ok: false, error: 'no-packaging' };
		if (!IDENTIFIER.test(name)) return { ok: false, error: 'invalid-definition-name' };
		if (this.definitions[name]) return { ok: false, error: 'duplicate-definition' };
		const document = this.currentDocument();
		const sourceLayout = cloneLayoutMap(this.layoutFor(this.path));
		const selected = new Set(draft.componentIds);
		const innerComponents = document.components.filter((component) => selected.has(component.id));
		if (innerComponents.length === 0) return { ok: false, error: 'empty-selection' };

		this.definitions = {
			...this.definitions,
			[name]: {
				name,
				inputs: { ...draft.inputs },
				outputs: { ...draft.outputs },
				document: { schemaVersion: 1, components: innerComponents }
			}
		};

		const instanceId = this.nextInstanceId();
		const instance: Component = {
			id: instanceId,
			kind: SUB_CIRCUIT_KIND,
			params: { definition: name },
			inputs: { ...draft.inputs },
			outputs: { ...draft.outputs }
		};
		this.updateCurrentDocument({
			...document,
			components: [
				...document.components.filter((component) => !selected.has(component.id)),
				instance
			]
		});

		const bounds = selectionBounds(
			document,
			sourceLayout,
			(component) => this.pinsFor(component) ?? { inputs: [], outputs: [] },
			selected
		);
		const origin = bounds ? snapPoint({ x: bounds.x, y: bounds.y }) : { x: 0, y: 0 };
		const parentLayout = removeLayoutEntries(sourceLayout, selected);
		parentLayout[instanceId] = { position: origin };
		this.updateCurrentLayout(parentLayout);

		const innerLayout = cloneLayoutMap(this.layouts[name]);
		for (const component of innerComponents) {
			const entry = sourceLayout[component.id];
			const position = entry?.position ?? { x: 0, y: 0 };
			const shifted = { x: position.x - origin.x, y: position.y - origin.y };
			innerLayout[component.id] =
				entry?.label === undefined
					? { position: snapPoint(shifted) }
					: { position: snapPoint(shifted), label: entry.label };
		}
		this.layouts = { ...this.layouts, [name]: innerLayout };

		this.packaging = null;
		this.selection = withSelection(this.selection, [instanceId]);
		this.emit();
		return { ok: true, value: instanceId };
	}

	instantiateDefinition(name: string, position: Point): Result<Component> {
		const definition = this.definitions[name];
		if (!definition) return { ok: false, error: 'unknown-subcircuit' };
		const id = this.nextInstanceId();
		const instance: Component = {
			id,
			kind: SUB_CIRCUIT_KIND,
			params: { definition: name },
			inputs: {},
			outputs: {}
		};
		const document = this.currentDocument();
		this.updateCurrentDocument({
			...document,
			components: [...document.components, instance]
		});
		const layout = cloneLayoutMap(this.layoutFor(this.path));
		layout[id] = { position: snapPoint(position) };
		this.updateCurrentLayout(layout);
		this.emit();
		return { ok: true, value: instance };
	}

	enterDefinition(name: string): UnitResult {
		if (!this.definitions[name]) return { ok: false, error: 'unknown-subcircuit' };
		this.path = [...this.path, name];
		this.selection = emptySelection();
		this.pendingKind = null;
		this.pendingWire = null;
		this.packaging = null;
		this.emit();
		return { ok: true };
	}

	navigateTo(depth: number): UnitResult {
		if (!Number.isInteger(depth) || depth < 0 || depth > this.path.length) {
			return { ok: false, error: 'invalid-depth' };
		}
		this.path = this.path.slice(0, depth);
		this.selection = emptySelection();
		this.pendingKind = null;
		this.pendingWire = null;
		this.packaging = null;
		this.emit();
		return { ok: true };
	}

	navigateToRoot(): void {
		this.navigateTo(0);
	}

	flattenCurrent(): CircuitDocument {
		return flatten(this.circuit, this.definitions, primitiveKinds);
	}
}
