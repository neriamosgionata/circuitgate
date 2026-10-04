import type { CircuitDocument } from '../model/circuit';
import { compile, type CompiledNetlist, type ComponentKinds } from './compile';
import { EventQueue, type QueueEntry } from './eventQueue';
import { resolveDrivers, type LogicValue } from './values';

export interface SettleOptions {
	maxDeltaCycles?: number;
}

export interface SettleResult {
	status: 'stable' | 'oscillation';
	cycles: number;
	oscillatingNets: number[];
}

export interface TimedOptions {
	ticks: number;
}

export interface TimedStepOptions {
	ticks?: number;
}

export interface TimedResult {
	snapshots: LogicValue[][];
}

export const DEFAULT_MAX_DELTA_CYCLES = 1000;

export class Simulator {
	readonly netlist: CompiledNetlist;
	private values: LogicValue[];
	private states: unknown[];
	private timedQueue: EventQueue | null = null;
	private timedTick = 0;

	constructor(
		document: CircuitDocument,
		kinds: ComponentKinds,
		initialValues: Readonly<Record<string, LogicValue>> = {}
	) {
		this.netlist = compile(document, kinds);
		this.values = this.netlist.netIds.map((id) => initialValues[id] ?? 'X');
		this.states = this.netlist.components.map((component) => component.state);
	}

	getNet(netId: string): LogicValue | undefined {
		const index = this.netlist.netIndex.get(netId);
		return index === undefined ? undefined : this.values[index];
	}

	setNet(netId: string, value: LogicValue): void {
		const index = this.netlist.netIndex.get(netId);
		if (index === undefined) {
			throw new Error(`unknown net: ${netId}`);
		}
		this.values[index] = value;
	}

	setState(componentId: string, state: unknown): void {
		const component = this.netlist.components.find((candidate) => candidate.id === componentId);
		if (!component) {
			throw new Error(`unknown component: ${componentId}`);
		}
		this.states[component.index] = state;
	}

	settle(options: SettleOptions = {}): SettleResult {
		const max = options.maxDeltaCycles ?? DEFAULT_MAX_DELTA_CYCLES;
		if (!Number.isFinite(max) || max < 1) {
			throw new Error(`maxDeltaCycles must be a positive integer, got ${max}`);
		}

		let cycles = 0;
		let lastChanged: number[] = [];

		for (;;) {
			const staged = new Map<number, LogicValue[]>();
			const nextStates: unknown[] = this.states.slice();

			for (const component of this.netlist.components) {
				const inputs = component.inputNets.map<LogicValue>((net) => this.values[net]);
				const outcome = component.kind.evaluate(inputs, this.states[component.index]);
				nextStates[component.index] = outcome.state === undefined ? this.states[component.index] : outcome.state;
				outcome.outputs.forEach((value, pin) => {
					const net = component.outputNets[pin];
					const drivers = staged.get(net);
					if (drivers) {
						drivers.push(value);
					} else {
						staged.set(net, [value]);
					}
				});
			}

			this.states = nextStates;

			const changed: number[] = [];
			for (const [net, drivers] of staged) {
				const resolved = resolveDrivers(drivers);
				if (this.values[net] !== resolved) {
					this.values[net] = resolved;
					changed.push(net);
				}
			}

			if (changed.length === 0) {
				return { status: 'stable', cycles, oscillatingNets: [] };
			}

			cycles += 1;
			lastChanged = changed;
			if (cycles >= max) break;
		}

		for (const net of lastChanged) {
			this.values[net] = 'X';
		}
		return {
			status: 'oscillation',
			cycles,
			oscillatingNets: [...lastChanged].sort((a, b) => a - b)
		};
	}

	runTimed(options: TimedOptions): TimedResult {
		const ticks = options.ticks;
		if (!Number.isInteger(ticks) || ticks < 0) {
			throw new Error(`ticks must be a non-negative integer, got ${ticks}`);
		}

		const queue = new EventQueue();
		for (const component of this.netlist.components) {
			queue.push(0, component.index);
		}

		const snapshots: LogicValue[][] = [];
		for (let tick = 0; tick < ticks; tick++) {
			this.processTimedTick(queue, tick);
			snapshots.push(this.values.slice());
		}

		return { snapshots };
	}

	private processTimedTick(queue: EventQueue, tick: number): void {
		const due: number[] = [];
		while (queue.size > 0 && (queue.peek() as QueueEntry).tick === tick) {
			due.push((queue.pop() as QueueEntry).index);
		}
		if (due.length === 0) return;

		const staged = new Map<number, LogicValue[]>();
		const nextStates = new Map<number, unknown>();

		for (const index of due) {
			const component = this.netlist.components[index];
			const inputs = component.inputNets.map<LogicValue>((net) => this.values[net]);
			const outcome = component.kind.evaluate(inputs, this.states[index]);
			nextStates.set(index, outcome.state === undefined ? this.states[index] : outcome.state);
			outcome.outputs.forEach((value, pin) => {
				const net = component.outputNets[pin];
				const drivers = staged.get(net);
				if (drivers) {
					drivers.push(value);
				} else {
					staged.set(net, [value]);
				}
			});
		}

		const changed = new Set<number>();
		for (const [net, drivers] of staged) {
			const resolved = resolveDrivers(drivers);
			if (this.values[net] !== resolved) {
				this.values[net] = resolved;
				changed.add(net);
			}
		}
		for (const [index, state] of nextStates) {
			this.states[index] = state;
		}

		for (const net of changed) {
			for (const dependent of this.netlist.dependents[net]) {
				queue.push(tick + 1, dependent);
			}
		}
		for (const index of due) {
			if (this.netlist.components[index].selfScheduling) {
				queue.push(tick + 1, index);
			}
		}
	}

	private ensureTimedQueue(): EventQueue {
		if (!this.timedQueue) {
			this.timedQueue = new EventQueue();
			for (const component of this.netlist.components) {
				this.timedQueue.push(0, component.index);
			}
			this.timedTick = 0;
		}
		return this.timedQueue;
	}

	wake(componentId: string, delay = 1): void {
		const component = this.netlist.components.find((candidate) => candidate.id === componentId);
		if (!component) {
			throw new Error(`unknown component: ${componentId}`);
		}
		if (!Number.isInteger(delay) || delay < 0) {
			throw new Error(`delay must be a non-negative integer, got ${delay}`);
		}
		const queue = this.ensureTimedQueue();
		queue.push(Math.max(this.timedTick, this.timedTick + delay), component.index);
	}

	stepTimed(options: TimedStepOptions = {}): TimedResult {
		const ticks = options.ticks ?? 1;
		if (!Number.isInteger(ticks) || ticks < 0) {
			throw new Error(`ticks must be a non-negative integer, got ${ticks}`);
		}
		const queue = this.ensureTimedQueue();
		const snapshots: LogicValue[][] = [];
		for (let index = 0; index < ticks; index++) {
			this.processTimedTick(queue, this.timedTick);
			snapshots.push(this.values.slice());
			this.timedTick += 1;
		}
		return { snapshots };
	}
}
