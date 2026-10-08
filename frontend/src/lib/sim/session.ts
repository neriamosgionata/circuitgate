import { CompileError } from '../engine/compile';
import { Simulator } from '../engine/evaluate';
import { flatten, type SubcircuitDefinitions } from '../engine/hierarchy';
import { resolveComponentKind } from '../engine/kinds';
import { primitiveKinds } from '../engine/primitives';
import type { LogicValue } from '../engine/values';
import type { CircuitDocument, Component } from '../model/circuit';
import { validateDocumentShape } from '../model/schema';
import {
	PROTOCOL_VERSION,
	isSimulationEvent,
	type CompileIssue,
	type InitCommand,
	type NetChange,
	type SimulationCommand,
	type SimulationEvent,
	type SimulationMode,
	type SimulationStatus
} from './protocol';
import { WaveformRecorder, type WaveformChange } from './recorder';

export type Scheduler = (callback: () => void) => () => void;

export const defaultScheduler: Scheduler = (callback) => {
	const handle = setTimeout(callback, 16);
	return () => clearTimeout(handle);
};

export interface SimulationHostOptions {
	schedule?: Scheduler;
	maxDeltaCycles?: number;
	retentionPerNet?: number;
}

/** Max pins named per blocked-component entry before a count remainder. */
const MAX_LISTED_PINS = 8;

/**
 * KTD3 pre-check: unconnected pins block simulation with one Diagnostics entry
 * per blocked component. Each issue names the component and its unconnected
 * pins (comma-separated, truncated with a count remainder) and carries the
 * component id for focus on demand. The engine CompileError paths remain as
 * backstops for anything this pre-check does not cover (unknown kinds,
 * duplicate ids, invalid params, hierarchy errors).
 */
function findBlockedComponents(flat: CircuitDocument): CompileIssue[] {
	const issues: CompileIssue[] = [];
	for (const component of flat.components) {
		let kind;
		try {
			kind = resolveComponentKind(component.kind, component.params);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const code = error instanceof CompileError && error.code ? error.code : 'compile-error';
			issues.push({ code, message, componentIds: [component.id] });
			continue;
		}
		if (!kind) continue;
		const missingInputs = kind.inputs.filter((pin) => component.inputs[pin] === undefined);
		const missingOutputs = kind.outputs.filter((pin) => component.outputs[pin] === undefined);
		const missing = [...missingInputs, ...missingOutputs];
		if (missing.length === 0) continue;
		if (missing.length === 1) {
			const side = missingInputs.length === 1 ? 'input' : 'output';
			issues.push({
				code: 'compile-error',
				message: `component ${component.id} is missing ${side} pin ${missing[0]}`,
				componentIds: [component.id]
			});
			continue;
		}
		const listed = missing.slice(0, MAX_LISTED_PINS).join(', ');
		const remainder = missing.length > MAX_LISTED_PINS ? ` (+${missing.length - MAX_LISTED_PINS} more)` : '';
		issues.push({
			code: 'compile-error',
			message: `component ${component.id} is missing ${missing.length} pins: ${listed}${remainder}`,
			componentIds: [component.id]
		});
	}
	return issues;
}

export class SimulationHost {
	private readonly emitEvent: (event: SimulationEvent) => void;
	private readonly schedule: Scheduler;
	private readonly maxDeltaCycles: number;
	readonly recorder: WaveformRecorder;

	private simulator: Simulator | null = null;
	private document: CircuitDocument | null = null;
	private definitions: SubcircuitDefinitions = {};
	private flatDocument: CircuitDocument | null = null;
	private netIds: string[] = [];
	private netOrder = new Map<string, number>();
	private currentMode: SimulationMode = 'delta';
	private isRunning = false;
	private currentTick = 0;
	private currentFrame = 0;
	private lastStatus: SimulationStatus = 'stable';
	private cancelRun: (() => void) | null = null;
	private cancelFlush: (() => void) | null = null;
	private pendingChanges = new Map<string, NetChange>();
	private lastValues = new Map<string, LogicValue>();
	private oscillatingNets = new Set<string>();
	private lastOscillationKey: string | null = null;
	private initialValues: Readonly<Record<string, LogicValue>> = {};

	constructor(emit: (event: SimulationEvent) => void, options: SimulationHostOptions = {}) {
		this.emitEvent = emit;
		this.schedule = options.schedule ?? defaultScheduler;
		this.maxDeltaCycles = options.maxDeltaCycles ?? 1000;
		this.recorder = new WaveformRecorder(
			options.retentionPerNet === undefined ? {} : { retentionPerNet: options.retentionPerNet }
		);
	}

	get running(): boolean {
		return this.isRunning;
	}

	get tick(): number {
		return this.currentTick;
	}

	handle(command: SimulationCommand): void {
		try {
			switch (command.type) {
				case 'init':
					this.initialize(command.document, command.definitions ?? {}, command.mode ?? this.currentMode, command.initialValues ?? {}, command.protocolVersion, command.id);
					return;
				case 'toggle':
					this.emitAck(command);
					this.toggle(command.componentId);
					break;
				case 'setInput':
					this.emitAck(command);
					this.setInput(command.componentId, command.value);
					break;
				case 'step':
					this.emitAck(command);
					this.step(command.ticks ?? 1);
					break;
				case 'run':
					this.emitAck(command);
					this.startRun();
					break;
				case 'pause':
					this.emitAck(command);
					this.stopRun();
					break;
				case 'reset':
					this.emitAck(command);
					if (this.document) {
						this.initialize(this.document, this.definitions, this.currentMode, this.initialValues, PROTOCOL_VERSION, 0);
					}
					break;
				case 'setMode':
					this.emitAck(command);
					if (command.mode !== this.currentMode && this.document) {
						this.initialize(this.document, this.definitions, command.mode, this.initialValues, PROTOCOL_VERSION, 0);
					}
					break;
				case 'history':
					this.emitAck(command);
					this.emitHistory(command.id);
					break;
			}
		} catch (error) {
			this.emitEvent({ type: 'compileError', correlationId: command.id, issues: [this.issueFromError(error)] });
		}
	}

	dispose(): void {
		this.stopRunInternal();
		this.cancelPendingFlush();
		this.simulator = null;
		this.document = null;
		this.flatDocument = null;
	}

	private initialize(
		document: CircuitDocument,
		definitions: SubcircuitDefinitions,
		mode: SimulationMode,
		initialValues: Readonly<Record<string, LogicValue>>,
		protocolVersion: number | undefined,
		correlationId: number
	): void {
		this.stopRunInternal();
		this.cancelPendingFlush();
		this.recorder.clear();
		this.lastValues.clear();
		this.oscillatingNets.clear();
		this.lastOscillationKey = null;
		this.currentTick = 0;
		this.currentFrame = 0;
		this.lastStatus = 'stable';
		this.document = document;
		this.definitions = definitions;
		this.currentMode = mode;
		this.initialValues = initialValues;
		this.simulator = null;
		this.flatDocument = null;
		this.netIds = [];
		this.netOrder = new Map();

		if (protocolVersion !== undefined && protocolVersion !== PROTOCOL_VERSION) {
			this.emitEvent({
				type: 'compileError',
				correlationId,
				issues: [
					{
						code: 'unsupported-protocol',
						message: `unsupported protocol version ${protocolVersion}; expected ${PROTOCOL_VERSION}`
					}
				]
			});
			this.emitStatus();
			return;
		}

		const shapeIssues = validateDocumentShape(document);
		if (shapeIssues.length > 0) {
			this.emitEvent({
				type: 'compileError',
				correlationId,
				issues: shapeIssues.map((issue) => ({
					code: 'invalid-document',
					message: issue.message,
					path: issue.path
				}))
			});
			this.emitStatus();
			return;
		}

		try {
			// KTD1/KTD4: the sim session init path is the single place that
			// resolves parameterized components. Each flattened component
			// resolves from its own kind and parameters with fallback to the
			// static registry; definitions validate through the same seam.
			// There is no separate worker-side registry.
			const flat = flatten(document, definitions, resolveComponentKind);
			this.flatDocument = flat;
			const blocked = findBlockedComponents(flat);
			if (blocked.length > 0) {
				this.emitEvent({ type: 'compileError', correlationId, issues: blocked });
				this.emitStatus();
				return;
			}
			this.simulator = new Simulator(flat, resolveComponentKind, initialValues);
		} catch (error) {
			this.emitEvent({ type: 'compileError', correlationId, issues: [this.issueFromError(error)] });
			this.emitStatus();
			return;
		}

		this.netIds = [...this.simulator.netlist.netIds];
		this.netIds.forEach((net, index) => this.netOrder.set(net, index));
		const components = this.flatDocument.components.map((component) => ({
			id: component.id,
			kind: component.kind
		}));

		this.emitEvent({
			type: 'ready',
			correlationId,
			mode: this.currentMode,
			nets: [...this.netIds],
			components
		});

		if (this.currentMode === 'timed') {
			this.simulator.stepTimed({ ticks: 1 });
			this.commit(0, 'stable', []);
		} else {
			const result = this.simulator.settle({ maxDeltaCycles: this.maxDeltaCycles });
			this.commit(0, result.status, result.oscillatingNets);
		}
		this.emitStatus();
	}

	private toggle(componentId: string): void {
		const simulator = this.simulator;
		if (!simulator) return;
		const component = simulator.netlist.components.find((candidate) => candidate.id === componentId);
		if (!component || component.kind !== primitiveKinds['switch']) return;
		const net = this.netIds[component.outputNets[0]];
		const current = net === undefined ? undefined : this.lastValues.get(net);
		this.applySwitch(componentId, current === 1 ? 0 : 1);
	}

	private setInput(componentId: string, value: LogicValue): void {
		const simulator = this.simulator;
		if (!simulator) return;
		const component = simulator.netlist.components.find((candidate) => candidate.id === componentId);
		if (!component || component.kind !== primitiveKinds['switch']) return;
		if (value !== 0 && value !== 1 && value !== 'X' && value !== 'Z') return;
		this.applySwitch(componentId, value);
	}

	private applySwitch(componentId: string, value: LogicValue): void {
		const simulator = this.simulator;
		if (!simulator) return;
		simulator.setState(componentId, { value });
		if (this.currentMode === 'timed') {
			simulator.wake(componentId, 0);
			return;
		}
		const result = simulator.settle({ maxDeltaCycles: this.maxDeltaCycles });
		this.currentTick += 1;
		this.commit(this.currentTick, result.status, result.oscillatingNets);
		this.emitStatus();
	}

	private step(ticks: number): void {
		if (!this.simulator || this.isRunning) return;
		const count = Number.isInteger(ticks) && ticks > 0 ? ticks : 1;
		this.advance(count);
	}

	private advance(count: number): void {
		const simulator = this.simulator;
		if (!simulator) return;
		for (let index = 0; index < count; index++) {
			if (this.currentMode === 'timed') {
				simulator.stepTimed({ ticks: 1 });
				this.currentTick += 1;
				this.commit(this.currentTick, 'stable', []);
			} else {
				const result = simulator.settle({ maxDeltaCycles: this.maxDeltaCycles });
				this.currentTick += 1;
				this.commit(this.currentTick, result.status, result.oscillatingNets);
			}
		}
		this.emitStatus();
	}

	private startRun(): void {
		if (this.isRunning || !this.simulator) return;
		this.isRunning = true;
		this.emitStatus();
		const loop = () => {
			this.cancelRun = null;
			if (!this.isRunning || !this.simulator) return;
			this.advance(1);
			this.cancelRun = this.schedule(loop);
		};
		this.cancelRun = this.schedule(loop);
	}

	private stopRun(): void {
		const wasRunning = this.isRunning;
		this.stopRunInternal();
		if (wasRunning) this.emitStatus();
	}

	private stopRunInternal(): void {
		this.isRunning = false;
		this.cancelRun?.();
		this.cancelRun = null;
	}

	private cancelPendingFlush(): void {
		this.cancelFlush?.();
		this.cancelFlush = null;
		this.pendingChanges.clear();
	}

	private commit(tick: number, status: SimulationStatus, oscillatingIndexes: readonly number[]): void {
		const simulator = this.simulator;
		if (!simulator) return;
		const oscillating = new Set(oscillatingIndexes.map((index) => this.netIds[index]));
		for (let index = 0; index < this.netIds.length; index++) {
			const net = this.netIds[index];
			const value = simulator.getNet(net) as LogicValue;
			const isOscillating = oscillating.has(net);
			if (this.lastValues.get(net) === value && this.oscillatingNets.has(net) === isOscillating) {
				continue;
			}
			this.lastValues.set(net, value);
			if (isOscillating) this.oscillatingNets.add(net);
			else this.oscillatingNets.delete(net);
			this.recorder.record(tick, net, value, isOscillating);
			this.pendingChanges.set(net, { net, value, oscillating: isOscillating, tick });
		}
		this.lastStatus = status;
		if (status === 'oscillation' && oscillating.size > 0) {
			const key = [...oscillating].sort().join(',');
			if (key !== this.lastOscillationKey) {
				this.lastOscillationKey = key;
				this.emitOscillationDiagnostic(oscillating, tick);
			}
		} else {
			this.lastOscillationKey = null;
		}
		this.scheduleFlush();
	}

	private emitOscillationDiagnostic(oscillating: ReadonlySet<string>, tick: number): void {
		const nets = [...oscillating].sort();
		this.emitEvent({
			type: 'diagnostic',
			diagnostic: {
				id: `oscillation:${nets.join(',')}`,
				kind: 'oscillation',
				message: `oscillation detected on ${nets.length} net${nets.length === 1 ? '' : 's'}`,
				nets,
				componentIds: this.componentsTouchingNets(nets),
				tick
			}
		});
	}

	private componentsTouchingNets(nets: readonly string[]): string[] {
		const wanted = new Set(nets);
		const ids: string[] = [];
		for (const component of this.flatDocument?.components ?? []) {
			const touched =
				Object.values(component.inputs).some((net) => wanted.has(net)) ||
				Object.values(component.outputs).some((net) => wanted.has(net));
			if (touched) ids.push(component.id);
		}
		return ids;
	}

	private scheduleFlush(): void {
		if (this.pendingChanges.size === 0 || this.cancelFlush) return;
		this.cancelFlush = this.schedule(() => {
			this.cancelFlush = null;
			this.flush();
		});
	}

	private flush(): void {
		if (this.pendingChanges.size === 0) return;
		const changes = [...this.pendingChanges.values()].sort(
			(a, b) => (this.netOrder.get(a.net) ?? 0) - (this.netOrder.get(b.net) ?? 0)
		);
		this.pendingChanges.clear();
		this.currentFrame += 1;
		this.emitEvent({
			type: 'values',
			frame: this.currentFrame,
			tick: this.currentTick,
			status: this.lastStatus,
			changes
		});
	}

	private emitHistory(correlationId: number): void {
		const nets: Record<string, WaveformChange[]> = {};
		for (const net of this.recorder.nets()) nets[net] = [...this.recorder.history(net)];
		this.emitEvent({ type: 'history', correlationId, nets });
	}

	private emitAck(command: SimulationCommand): void {
		this.emitEvent({ type: 'ack', correlationId: command.id, command: command.type });
	}

	private emitStatus(): void {
		this.emitEvent({
			type: 'status',
			running: this.isRunning,
			mode: this.currentMode,
			tick: this.currentTick
		});
	}

	private issueFromError(error: unknown): CompileIssue {
		const message = error instanceof Error ? error.message : String(error);
		const code = error instanceof CompileError && error.code ? error.code : 'compile-error';
		return { code, message, componentIds: this.componentIdsIn(message) };
	}

	private componentIdsIn(message: string): string[] {
		const ids: string[] = [];
		const seen = new Set<string>();
		const documents: Component[] = [...(this.document?.components ?? [])];
		for (const definition of Object.values(this.definitions)) {
			documents.push(...definition.document.components);
		}
		for (const component of documents) {
			if (component.id.length > 0 && message.includes(component.id) && !seen.has(component.id)) {
				seen.add(component.id);
				ids.push(component.id);
			}
		}
		return ids;
	}
}

export interface SimulationSession {
	send(command: SimulationCommand): void;
	dispose(): void;
}

export class LocalSimulationSession implements SimulationSession {
	readonly host: SimulationHost;

	constructor(onEvent: (event: SimulationEvent) => void, options: SimulationHostOptions = {}) {
		this.host = new SimulationHost(onEvent, options);
	}

	send(command: SimulationCommand): void {
		this.host.handle(command);
	}

	dispose(): void {
		this.host.dispose();
	}
}

export interface WorkerLike {
	postMessage(message: unknown): void;
	terminate(): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface WorkerSessionOptions {
	createWorker: () => WorkerLike;
	document: CircuitDocument;
	definitions?: SubcircuitDefinitions;
	mode?: SimulationMode;
	initialValues?: Readonly<Record<string, LogicValue>>;
	onEvent: (event: SimulationEvent) => void;
}

export class WorkerSimulationSession implements SimulationSession {
	private readonly options: WorkerSessionOptions;
	private worker: WorkerLike;
	private commandId = 0;
	private disposed = false;
	private currentMode: SimulationMode;

	constructor(options: WorkerSessionOptions) {
		this.options = options;
		this.currentMode = options.mode ?? 'delta';
		this.worker = this.spawn();
	}

	private spawn(): WorkerLike {
		const worker = this.options.createWorker();
		worker.addEventListener('message', (event) => {
			if (this.disposed || worker !== this.worker) return;
			const data = (event as { data?: unknown }).data;
			if (isSimulationEvent(data)) this.options.onEvent(data);
		});
		worker.addEventListener('error', (event) => {
			if (this.disposed || worker !== this.worker) return;
			const message = (event as { message?: string }).message ?? 'worker error';
			this.respawn(message);
		});
		worker.addEventListener('messageerror', () => {
			if (this.disposed || worker !== this.worker) return;
			this.respawn('message deserialization error');
		});
		const init: InitCommand = {
			type: 'init',
			id: ++this.commandId,
			protocolVersion: PROTOCOL_VERSION,
			document: this.options.document,
			definitions: this.options.definitions,
			mode: this.currentMode,
			initialValues: this.options.initialValues
		};
		worker.postMessage(init);
		return worker;
	}

	private respawn(reason: string): void {
		const previous = this.worker;
		previous.terminate();
		this.worker = this.spawn();
		this.options.onEvent({ type: 'restarted', reason });
	}

	send(command: SimulationCommand): void {
		if (this.disposed) return;
		if (command.type === 'setMode') this.currentMode = command.mode;
		this.worker.postMessage(command);
	}

	dispose(): void {
		this.disposed = true;
		this.worker.terminate();
	}
}
