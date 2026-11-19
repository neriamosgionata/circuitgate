import type { CircuitDocument } from '../model/circuit';
import type { CompiledComponent, KindResolver, TimingResolver } from './compile';
import { Simulator } from './evaluate';
import { PhysicalTaskQueue, type PhysicalTask } from './eventQueue';
import type { TimingProfile } from './timing';
import { resolveDrivers, type LogicValue } from './values';

export const DEFAULT_MAX_PHYSICAL_EVENTS = 100_000;
export const DEFAULT_MAX_DELTA_CYCLES = 1000;

export interface PhysicalTimingEvent {
	componentId: string;
	constraint: 'setup' | 'hold';
	edgeTimePs: number;
	windowFromPs: number;
	windowToPs: number;
}

export interface PhysicalStepResult {
	timePs: number;
	changedNetIndexes: number[];
	status: 'stable' | 'oscillation' | 'event-limit';
	oscillatingNetIndexes: number[];
	timingEvents: PhysicalTimingEvent[];
	/** Components whose compliant capture clears a prior timing diagnostic. */
	clearedComponentIds: string[];
}

export interface PhysicalOptions {
	maxEvents?: number;
	maxDeltaCycles?: number;
}

interface PendingCapture {
	edgeTimePs: number;
	commitTimePs: number;
	holdUntilPs: number;
	inputNets: number[];
	outputs: LogicValue[];
	state: unknown;
	setupViolated: boolean;
	holdViolated: boolean;
}

const ZERO_TIMING: TimingProfile = { delayPs: 0 };

interface DriverRef {
	component: number;
	pin: number;
}

export class PhysicalSimulator extends Simulator {
	private readonly queue = new PhysicalTaskQueue();
	private initialized = false;
	private currentTimePs = 0;
	private sequence = 0;
	private initialStep = true;
	private drivers: LogicValue[][] = [];
	private lastScheduled: LogicValue[][] = [];
	private lastChangePs: number[] = [];
	private lastClock: LogicValue[] = [];
	private driversByNet: DriverRef[][] = [];
	private pending = new Map<number, PendingCapture>();
	private initialTouched = new Set<number>();

	constructor(
		document: CircuitDocument,
		resolver: KindResolver,
		initialValues: Readonly<Record<string, LogicValue>> = {},
		timingResolver?: TimingResolver
	) {
		super(document, resolver, initialValues, timingResolver);
	}

	get timePs(): number {
		return this.currentTimePs;
	}

	/** Queue a source (switch) evaluation at the current simulated time. */
	wakePhysical(componentId: string): void {
		this.ensureInitialized();
		const component = this.netlist.components.find((candidate) => candidate.id === componentId);
		if (!component) throw new Error(`unknown component: ${componentId}`);
		this.queue.push({
			timePs: this.currentTimePs,
			sequence: this.nextSequence(),
			kind: 'evaluate',
			componentIndex: component.index
		});
	}

	stepPhysical(options: PhysicalOptions = {}): PhysicalStepResult {
		this.ensureInitialized();
		const maxEvents = options.maxEvents ?? DEFAULT_MAX_PHYSICAL_EVENTS;
		const maxDeltaCycles = options.maxDeltaCycles ?? DEFAULT_MAX_DELTA_CYCLES;
		const next = this.queue.peek();
		if (!next) {
			return {
				timePs: this.currentTimePs,
				changedNetIndexes: [],
				status: 'stable',
				oscillatingNetIndexes: [],
				timingEvents: [],
				clearedComponentIds: []
			};
		}

		const due = this.queue.due(next.timePs);
		if (due.length > maxEvents) {
			for (const task of due) this.queue.push(task);
			return {
				timePs: next.timePs,
				changedNetIndexes: [],
				status: 'event-limit',
				oscillatingNetIndexes: [],
				timingEvents: [],
				clearedComponentIds: []
			};
		}

		this.currentTimePs = next.timePs;
		const timingEvents: PhysicalTimingEvent[] = [];
		const cleared = new Set<string>();
		const touched = new Set<number>(this.initialStep ? this.initialTouched : []);
		const evaluate = new Set<number>();

		for (const task of due) {
			if (task.kind === 'transition') {
				this.applyTransition(task, touched);
			} else if (task.kind === 'evaluate') {
				evaluate.add(task.componentIndex);
			} else {
				this.commitPending(task.componentIndex, touched, timingEvents, cleared);
			}
		}

		const settled = this.settleAtTime(
			maxEvents,
			maxDeltaCycles,
			evaluate,
			touched,
			timingEvents,
			cleared
		);
		this.initialStep = false;
		return {
			timePs: this.currentTimePs,
			changedNetIndexes: [...settled.changed],
			status: settled.status,
			oscillatingNetIndexes: settled.oscillating,
			timingEvents,
			clearedComponentIds: [...cleared]
		};
	}

	private nextSequence(): number {
		this.sequence += 1;
		return this.sequence;
	}

	private ensureInitialized(): void {
		if (this.initialized) return;
		this.initialized = true;
		this.currentTimePs = 0;
		this.drivers = this.netlist.components.map((component) =>
			component.kind.outputs.map(() => 'X' as LogicValue)
		);
		this.lastScheduled = this.drivers.map((pins) => [...pins]);
		this.lastChangePs = this.netlist.netIds.map(() => -1);
		this.lastClock = this.netlist.components.map(() => 'X' as LogicValue);
		this.driversByNet = this.netlist.netIds.map(() => []);

		for (const component of this.netlist.components) {
			component.outputNets.forEach((net, pin) => {
				this.driversByNet[net].push({ component: component.index, pin });
			});
		}

		for (const component of this.netlist.components) {
			const profile = component.timing ?? ZERO_TIMING;
			if (profile.clock) {
				this.initialiseClock(component.index, profile);
			}
		}

		for (const component of this.netlist.components) {
			const profile = component.timing ?? ZERO_TIMING;
			if (!profile.sequential) continue;
			const clockIndex = component.kind.inputs.indexOf('clk');
			if (clockIndex < 0) continue;
			this.lastClock[component.index] = this.values[component.inputNets[clockIndex]];
		}

		for (const component of this.netlist.components) {
			this.queue.push({
				timePs: 0,
				sequence: this.nextSequence(),
				kind: 'evaluate',
				componentIndex: component.index
			});
		}
	}

	private initialiseClock(componentIndex: number, profile: TimingProfile): void {
		const component = this.netlist.components[componentIndex];
		const period = profile.periodPs ?? 20_000;
		const duty = profile.duty ?? 0.5;
		for (const net of component.outputNets) {
			this.values[net] = 0;
			this.initialTouched.add(net);
		}
		this.drivers[componentIndex] = component.kind.outputs.map(() => 0 as LogicValue);
		this.lastScheduled[componentIndex] = component.kind.outputs.map(() => 0 as LogicValue);
		const firstRise = Math.max(1, Math.round((1 - duty) * period));
		this.queue.push({
			timePs: firstRise,
			sequence: this.nextSequence(),
			kind: 'transition',
			componentIndex,
			pin: 0,
			value: 1
		});
	}

	private applyTransition(task: PhysicalTask, touched: Set<number>): void {
		if (task.pin === undefined || task.value === undefined) return;
		const component = this.netlist.components[task.componentIndex];
		this.drivers[task.componentIndex][task.pin] = task.value;
		touched.add(component.outputNets[task.pin]);
		if (component.timing?.clock) {
			this.scheduleNextClock(task.componentIndex, task.timePs, task.value);
		}
	}

	private scheduleNextClock(componentIndex: number, timePs: number, value: LogicValue): void {
		const profile = this.netlist.components[componentIndex].timing;
		if (!profile?.clock) return;
		const period = profile.periodPs ?? 20_000;
		const duty = profile.duty ?? 0.5;
		const nextValue: LogicValue = value === 1 ? 0 : 1;
		const delay = value === 1 ? Math.max(1, Math.round(duty * period)) : Math.max(1, Math.round((1 - duty) * period));
		this.queue.push({
			timePs: timePs + delay,
			sequence: this.nextSequence(),
			kind: 'transition',
			componentIndex,
			pin: 0,
			value: nextValue
		});
	}

	private settleAtTime(
		maxEvents: number,
		maxDeltaCycles: number,
		evaluate: Set<number>,
		touched: Set<number>,
		timingEvents: PhysicalTimingEvent[],
		cleared: Set<string>
	): { changed: Set<number>; status: 'stable' | 'oscillation' | 'event-limit'; oscillating: number[] } {
		const changed = new Set<number>();
		let evaluations = 0;
		let cycles = 0;

		for (;;) {
			if (touched.size > 0) {
				const pendingTouched = [...touched];
				touched.clear();
				for (const net of pendingTouched) {
					const resolved = resolveDrivers(
						this.driversByNet[net].map((ref) => this.drivers[ref.component][ref.pin])
					);
					if (this.values[net] === resolved) continue;
					this.values[net] = resolved;
					changed.add(net);
					if (!this.initialStep) {
						this.lastChangePs[net] = this.currentTimePs;
						this.markHoldViolations(net, this.currentTimePs);
					}
					for (const dependent of this.netlist.dependents[net]) evaluate.add(dependent);
				}
			}

			if (evaluate.size === 0) break;
			cycles += 1;
			if (cycles > maxDeltaCycles) {
				for (const net of changed) this.values[net] = 'X';
				return { changed, status: 'oscillation', oscillating: [...changed] };
			}

			const current = [...evaluate];
			evaluate.clear();
			for (const index of current) {
				if (this.pending.has(index)) continue;
				evaluations += 1;
				if (evaluations > maxEvents) {
					return { changed, status: 'event-limit', oscillating: [] };
				}
				this.evaluateComponent(index, touched, timingEvents, cleared);
			}
		}

		return { changed, status: 'stable', oscillating: [] };
	}

	private evaluateComponent(
		index: number,
		touched: Set<number>,
		timingEvents: PhysicalTimingEvent[],
		cleared: Set<string>
	): void {
		const component = this.netlist.components[index];
		const profile = component.timing ?? ZERO_TIMING;
		if (profile.clock) return;
		const inputs = component.inputNets.map((net) => this.values[net]);

		if (profile.sequential) {
			const clockInput = component.kind.inputs.indexOf('clk');
			if (clockInput < 0) return;
			const clk = this.values[component.inputNets[clockInput]];
			const previous = this.lastClock[index];
			this.lastClock[index] = clk;

			if (previous === 0 && clk === 1) {
				const setup = this.checkSetup(component, profile);
				const outcome = component.kind.evaluate(inputs, this.states[index]);
				const hold = profile.holdPs ?? 0;
				const clockToQ = profile.clockToQPs ?? 0;
				const edgeTime = this.currentTimePs;
				const pending: PendingCapture = {
					edgeTimePs: edgeTime,
					commitTimePs: edgeTime + Math.max(hold, clockToQ),
					holdUntilPs: edgeTime + hold,
					inputNets: component.inputNets.filter((_, pin) => pin !== clockInput),
					outputs: [...outcome.outputs],
					state: outcome.state,
					setupViolated: setup.violated,
					holdViolated: false
				};
				this.pending.set(index, pending);
				if (setup.violated) {
					timingEvents.push({
						componentId: component.id,
						constraint: 'setup',
						edgeTimePs: edgeTime,
						windowFromPs: setup.from,
						windowToPs: setup.to
					});
				}
				if (pending.commitTimePs <= edgeTime) {
					this.commitPending(index, touched, timingEvents, cleared);
				} else {
					this.queue.push({
						timePs: pending.commitTimePs,
						sequence: this.nextSequence(),
						kind: 'commit',
						componentIndex: index
					});
				}
				return;
			}

			const outcome = component.kind.evaluate(inputs, this.states[index]);
			if (outcome.state !== undefined) this.states[index] = outcome.state;
			this.queueOutputs(index, outcome.outputs, touched, profile);
			return;
		}

		const outcome = component.kind.evaluate(inputs, this.states[index]);
		if (outcome.state !== undefined) this.states[index] = outcome.state;
		this.queueOutputs(index, outcome.outputs, touched, profile);
	}

	private queueOutputs(
		index: number,
		outputs: readonly LogicValue[],
		touched: Set<number>,
		profile: TimingProfile
	): void {
		const component = this.netlist.components[index];
		outputs.forEach((value, pin) => {
			if (this.lastScheduled[index][pin] === value) return;
			this.lastScheduled[index][pin] = value;
			if (profile.delayPs > 0) {
				this.queue.push({
					timePs: this.currentTimePs + profile.delayPs,
					sequence: this.nextSequence(),
					kind: 'transition',
					componentIndex: index,
					pin,
					value
				});
				return;
			}
			this.drivers[index][pin] = value;
			touched.add(component.outputNets[pin]);
		});
	}

	private applyOutputs(index: number, outputs: readonly LogicValue[], touched: Set<number>): void {
		const component = this.netlist.components[index];
		outputs.forEach((value, pin) => {
			if (this.lastScheduled[index][pin] === value) return;
			this.lastScheduled[index][pin] = value;
			this.drivers[index][pin] = value;
			touched.add(component.outputNets[pin]);
		});
	}

	private checkSetup(
		component: CompiledComponent,
		profile: TimingProfile
	): { violated: boolean; from: number; to: number } {
		const clockInput = component.kind.inputs.indexOf('clk');
		const setup = profile.setupPs ?? 0;
		const from = this.currentTimePs - setup;
		const to = this.currentTimePs;
		for (let pin = 0; pin < component.inputNets.length; pin += 1) {
			if (pin === clockInput) continue;
			const value = this.values[component.inputNets[pin]];
			if (value !== 0 && value !== 1) continue;
			const last = this.lastChangePs[component.inputNets[pin]];
			if (last >= from && last <= to) return { violated: true, from, to };
		}
		return { violated: false, from, to };
	}

	private markHoldViolations(net: number, timePs: number): void {
		const value = this.values[net];
		if (value !== 0 && value !== 1) return;
		for (const pending of this.pending.values()) {
			if (timePs <= pending.edgeTimePs || timePs > pending.holdUntilPs) continue;
			if (!pending.inputNets.includes(net)) continue;
			pending.holdViolated = true;
		}
	}

	private commitPending(
		index: number,
		touched: Set<number>,
		timingEvents: PhysicalTimingEvent[],
		cleared: Set<string>
	): void {
		const pending = this.pending.get(index);
		if (!pending) return;
		this.pending.delete(index);
		const component = this.netlist.components[index];
		if (pending.setupViolated || pending.holdViolated) {
			const clockInput = component.kind.inputs.indexOf('clk');
			const xInputs = component.inputNets.map((net, pin) =>
				pin === clockInput ? this.values[net] : ('X' as LogicValue)
			);
			const xOutcome = component.kind.evaluate(xInputs, this.states[index]);
			if (xOutcome.state !== undefined) this.states[index] = xOutcome.state;
			this.applyOutputs(index, xOutcome.outputs, touched);
			if (pending.holdViolated && !pending.setupViolated) {
				timingEvents.push({
					componentId: component.id,
					constraint: 'hold',
					edgeTimePs: pending.edgeTimePs,
					windowFromPs: pending.edgeTimePs,
					windowToPs: pending.edgeTimePs + (component.timing?.holdPs ?? 0)
				});
			}
			return;
		}

		if (pending.state !== undefined) this.states[index] = pending.state;
		this.applyOutputs(index, pending.outputs, touched);
		cleared.add(component.id);
	}
}
