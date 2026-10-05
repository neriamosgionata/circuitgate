import { describe, expect, it } from 'vitest';
import type { CircuitDocument, Component } from '../../model/circuit';
import { DiagnosticsStore } from '../diagnostics';
import {
	PROTOCOL_VERSION,
	type AckEvent,
	type CompileErrorEvent,
	type DiagnosticEvent,
	type InitCommand,
	type ReadyEvent,
	type SimulationEvent,
	type ValuesEvent
} from '../protocol';
import { LocalSimulationSession, SimulationHost, WorkerSimulationSession, type Scheduler, type WorkerLike } from '../session';

class ManualScheduler {
	private callbacks = new Map<number, () => void>();
	private nextId = 0;

	readonly schedule: Scheduler = (callback) => {
		const id = this.nextId++;
		this.callbacks.set(id, callback);
		return () => {
			this.callbacks.delete(id);
		};
	};

	fireAll(): number {
		const pending = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of pending) callback();
		return pending.length;
	}

	drain(): void {
		for (let guard = 0; guard < 100 && this.callbacks.size > 0; guard++) this.fireAll();
	}

	get pending(): number {
		return this.callbacks.size;
	}
}

class FakeWorker implements WorkerLike {
	private listeners = new Map<string, Array<(event: unknown) => void>>();
	readonly messages: unknown[] = [];
	terminated = false;

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const list = this.listeners.get(type);
		if (list) list.push(listener);
		else this.listeners.set(type, [listener]);
	}

	emit(event: unknown): void {
		for (const listener of this.listeners.get('message') ?? []) listener({ data: event });
	}

	fail(message: string): void {
		for (const listener of this.listeners.get('error') ?? []) listener({ message });
	}
}

function simpleDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		components: [
			{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
			{ id: 'inv', kind: 'not', inputs: { a: 'A' }, outputs: { out: 'OUT' } }
		]
	};
}

function ringDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		components: [
			{ id: 'n1', kind: 'not', inputs: { a: 'N2' }, outputs: { out: 'N0' } },
			{ id: 'n2', kind: 'not', inputs: { a: 'N0' }, outputs: { out: 'N1' } },
			{ id: 'n3', kind: 'not', inputs: { a: 'N1' }, outputs: { out: 'N2' } }
		]
	};
}

function clockDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		components: [{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } }]
	};
}

function aluScaleDocument(): { document: CircuitDocument; switchId: string; outputNet: string } {
	const columns = 32;
	const layers = 64;
	const components: Component[] = [];
	for (let column = 0; column < columns; column++) {
		components.push({
			id: `sw${column}`,
			kind: 'switch',
			inputs: {},
			outputs: { out: `L0_${column}` }
		});
	}
	for (let layer = 1; layer < layers; layer++) {
		for (let column = 0; column < columns; column++) {
			components.push({
				id: `b${layer}_${column}`,
				kind: 'buffer',
				inputs: { a: `L${layer - 1}_${column}` },
				outputs: { out: `L${layer}_${column}` }
			});
		}
	}
	return {
		document: { schemaVersion: 1, components },
		switchId: 'sw0',
		outputNet: `L${layers - 1}_0`
	};
}

function makeHost(events: SimulationEvent[], options: ConstructorParameters<typeof SimulationHost>[1] = {}) {
	const scheduler = new ManualScheduler();
	const host = new SimulationHost((event) => events.push(event), { schedule: scheduler.schedule, ...options });
	return { host, scheduler, events };
}

function lastStatus(events: SimulationEvent[]) {
	return [...events].reverse().find((event) => event.type === 'status');
}

describe('protocol round-trip', () => {
	it('delivers commands and events with correlation ids', () => {
		const events: SimulationEvent[] = [];
		const scheduler = new ManualScheduler();
		const session = new LocalSimulationSession((event) => events.push(event), {
			schedule: scheduler.schedule
		});
		session.send({
			type: 'init',
			id: 7,
			protocolVersion: PROTOCOL_VERSION,
			document: simpleDocument(),
			mode: 'delta'
		});
		const ready = events.find((event) => event.type === 'ready') as ReadyEvent;
		expect(ready).toBeDefined();
		expect(ready.correlationId).toBe(7);
		expect(ready.mode).toBe('delta');
		expect(ready.nets).toContain('OUT');

		session.send({ type: 'toggle', id: 8, componentId: 'sw' });
		const ack = events.find((event) => event.type === 'ack') as AckEvent;
		expect(ack.correlationId).toBe(8);
		expect(ack.command).toBe('toggle');

		scheduler.drain();
		const values = events.filter((event) => event.type === 'values') as ValuesEvent[];
		expect(values.length).toBeGreaterThan(0);
		expect(values.every((event) => typeof event.frame === 'number')).toBe(true);
		session.dispose();
	});

	it('rejects an unsupported protocol version with a structured compile error', () => {
		const events: SimulationEvent[] = [];
		const { host } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION + 1,
			document: simpleDocument()
		});
		const error = events.find((event) => event.type === 'compileError') as CompileErrorEvent;
		expect(error).toBeDefined();
		expect(error.correlationId).toBe(1);
		expect(error.issues[0].code).toBe('unsupported-protocol');
	});
});

describe('clock controls', () => {
	it('advances the clock by the expected ticks and pauses on demand', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: clockDocument(),
			mode: 'timed'
		});
		scheduler.drain();

		host.handle({ type: 'step', id: 2, ticks: 3 });
		scheduler.drain();
		expect(host.tick).toBe(3);
		const history = host.recorder.history('CLK');
		expect(history.length).toBeGreaterThanOrEqual(4);
		for (let index = 1; index < history.length; index++) {
			expect(history[index].value).not.toBe(history[index - 1].value);
		}

		host.handle({ type: 'run', id: 3 });
		expect(host.running).toBe(true);
		scheduler.fireAll();
		scheduler.fireAll();
		expect(host.tick).toBe(5);

		host.handle({ type: 'pause', id: 4 });
		expect(host.running).toBe(false);
		const pausedTick = host.tick;
		scheduler.drain();
		expect(host.tick).toBe(pausedTick);
		expect(lastStatus(events)?.type).toBe('status');
	});

	it('steps a delta-cycle circuit one settle pass at a time', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: simpleDocument(),
			mode: 'delta'
		});
		scheduler.drain();
		host.handle({ type: 'step', id: 2 });
		scheduler.drain();
		expect(host.tick).toBe(1);
		expect(host.recorder.valueAt('OUT', 0)).toBe(1);
	});
});

describe('input toggling', () => {
	it('propagates a toggle through the circuit and coalesces values per frame', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: simpleDocument(),
			mode: 'delta'
		});
		scheduler.drain();
		const baseline = events.length;
		host.handle({ type: 'toggle', id: 2, componentId: 'sw' });
		host.handle({ type: 'step', id: 3 });
		scheduler.drain();

		const valueEvents = events.slice(baseline).filter((event) => event.type === 'values') as ValuesEvent[];
		expect(valueEvents).toHaveLength(1);
		const changes = valueEvents[0].changes;
		const finalA = [...changes].reverse().find((change) => change.net === 'A');
		const finalOut = [...changes].reverse().find((change) => change.net === 'OUT');
		expect(finalA?.value).toBe(1);
		expect(finalOut?.value).toBe(0);
		expect(host.recorder.valueAt('A', host.tick)).toBe(1);
		expect(host.recorder.valueAt('OUT', host.tick)).toBe(0);
		expect(host.recorder.valueAt('OUT', 0)).toBe(1);
	});

	it('ignores toggles of components that are not switches', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: simpleDocument(),
			mode: 'delta'
		});
		scheduler.drain();
		host.handle({ type: 'toggle', id: 2, componentId: 'inv' });
		scheduler.drain();
		const ack = events.find((event) => event.type === 'ack' && event.correlationId === 2);
		expect(ack).toBeDefined();
		expect(host.recorder.valueAt('OUT', 0)).toBe(1);
		expect(host.tick).toBe(0);
	});
});

describe('malformed documents', () => {
	it('reports a structured compile error instead of hanging', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		const bad: CircuitDocument = {
			schemaVersion: 1,
			components: [{ id: 'g', kind: 'and', inputs: { a: 'N' }, outputs: { out: 'M' } }]
		};
		host.handle({ type: 'init', id: 1, protocolVersion: PROTOCOL_VERSION, document: bad });
		const error = events.find((event) => event.type === 'compileError') as CompileErrorEvent;
		expect(error).toBeDefined();
		expect(error.issues[0].code).toBe('compile-error');
		expect(error.issues[0].message).toContain('missing input pin b');
		expect(error.issues[0].componentIds).toContain('g');

		host.handle({ type: 'step', id: 2 });
		scheduler.drain();
		expect(events.some((event) => event.type === 'ack' && event.correlationId === 2)).toBe(true);
		expect(host.running).toBe(false);
	});

	it('reports unknown component kinds as structured errors', () => {
		const events: SimulationEvent[] = [];
		const { host } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: { schemaVersion: 1, components: [{ id: 'x', kind: 'wormhole', inputs: {}, outputs: {} }] }
		});
		const error = events.find((event) => event.type === 'compileError') as CompileErrorEvent;
		expect(error.issues[0].message).toContain('unknown component kind');
	});
});

describe('timed mode', () => {
	it('produces a toggling waveform for a ring oscillator', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: ringDocument(),
			mode: 'timed',
			initialValues: { N0: 0, N1: 1, N2: 0 }
		});
		scheduler.drain();
		host.handle({ type: 'step', id: 2, ticks: 6 });
		scheduler.drain();

		const history = host.recorder.history('N0');
		expect(history.length).toBeGreaterThan(1);
		const levels = history.map((change) => change.value);
		expect(levels.every((value) => value === 0 || value === 1)).toBe(true);
		expect(new Set(levels).size).toBe(2);
	});

	it('propagates a toggle one unit delay at a time in timed mode', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		const document: CircuitDocument = {
			schemaVersion: 1,
			components: [
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'buf', kind: 'buffer', inputs: { a: 'A' }, outputs: { out: 'OUT' } }
			]
		};
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document,
			mode: 'timed'
		});
		scheduler.drain();
		host.handle({ type: 'toggle', id: 2, componentId: 'sw' });
		host.handle({ type: 'step', id: 3 });
		scheduler.drain();
		expect(host.recorder.valueAt('A', 1)).toBe(1);
		expect(host.recorder.valueAt('OUT', 1)).toBe(0);
		host.handle({ type: 'step', id: 4 });
		scheduler.drain();
		expect(host.recorder.valueAt('OUT', 2)).toBe(1);
	});

	it('reports history on demand with the recorder contents', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: clockDocument(),
			mode: 'timed'
		});
		scheduler.drain();
		host.handle({ type: 'step', id: 2, ticks: 2 });
		scheduler.drain();
		host.handle({ type: 'history', id: 3 });
		const history = events.find((event) => event.type === 'history');
		expect(history).toBeDefined();
		expect(history?.type === 'history' && history.correlationId).toBe(3);
		expect(history?.type === 'history' && history.nets['CLK']?.length).toBeGreaterThan(0);
	});
});

describe('oscillation and diagnostics', () => {
	it('flags oscillation as a diagnostic with affected components', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events, { maxDeltaCycles: 64 });
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: ringDocument(),
			mode: 'delta',
			initialValues: { N0: 0 }
		});
		scheduler.drain();
		const diagnostic = events.find((event) => event.type === 'diagnostic') as DiagnosticEvent;
		expect(diagnostic).toBeDefined();
		expect(diagnostic.diagnostic.kind).toBe('oscillation');
		expect(diagnostic.diagnostic.nets?.length).toBeGreaterThan(0);
		expect(diagnostic.diagnostic.componentIds?.length).toBeGreaterThan(0);
		const values = events.filter((event) => event.type === 'values') as ValuesEvent[];
		expect(values.at(-1)?.status).toBe('oscillation');
		expect(values.at(-1)?.changes.some((change) => change.oscillating)).toBe(true);
	});

	it('deduplicates and dismisses diagnostics', () => {
		const store = new DiagnosticsStore();
		const added = store.add({
			id: 'oscillation:N0',
			kind: 'oscillation',
			message: 'oscillation on N0',
			nets: ['N0'],
			componentIds: ['n1']
		});
		expect(added).toBe(true);
		expect(store.add({ id: 'oscillation:N0', kind: 'oscillation', message: 'again' })).toBe(false);
		expect(store.size).toBe(1);
		expect(store.dismiss('oscillation:N0')).toBe(true);
		expect(store.size).toBe(0);
		expect(store.dismiss('oscillation:N0')).toBe(false);
	});

	it('turns compile errors into dismissible diagnostics', () => {
		const store = new DiagnosticsStore();
		store.add({
			id: 'compile:compile-error:component g is missing input pin b',
			kind: 'compile-error',
			message: 'component g is missing input pin b',
			code: 'compile-error',
			componentIds: ['g']
		});
		const [first] = store.list();
		expect(first.kind).toBe('compile-error');
		expect(first.componentIds).toEqual(['g']);
		store.dismiss(first.id);
		expect(store.list()).toEqual([]);
	});
});

describe('worker crash recovery', () => {
	it('respawns a crashed worker from the document and restarts from the initial state', () => {
		const workers: FakeWorker[] = [];
		const events: SimulationEvent[] = [];
		const session = new WorkerSimulationSession({
			createWorker: () => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			document: simpleDocument(),
			mode: 'delta',
			onEvent: (event) => events.push(event)
		});
		expect(workers).toHaveLength(1);
		const firstInit = workers[0].messages[0] as InitCommand;
		expect(firstInit.type).toBe('init');
		expect(firstInit.protocolVersion).toBe(PROTOCOL_VERSION);
		workers[0].emit({ type: 'ready', correlationId: firstInit.id, mode: 'delta', nets: ['A'], components: [] });
		expect(events.some((event) => event.type === 'ready')).toBe(true);

		workers[0].fail('worker crashed');
		expect(workers[0].terminated).toBe(true);
		expect(workers).toHaveLength(2);
		const respawnInit = workers[1].messages[0] as InitCommand;
		expect(respawnInit.type).toBe('init');
		expect(respawnInit.document).toEqual(simpleDocument());
		const restarted = events.find((event) => event.type === 'restarted');
		expect(restarted).toBeDefined();

		session.send({ type: 'toggle', id: 99, componentId: 'sw' });
		expect((workers[1].messages.at(-1) as { type: string }).type).toBe('toggle');
		session.dispose();
	});
});

describe('ALU-scale latency smoke', () => {
	it('keeps toggle-to-values latency within the pure-path smoke budget', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		const { document, switchId, outputNet } = aluScaleDocument();
		expect(document.components.length).toBeGreaterThanOrEqual(2000);

		const started = performance.now();
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document,
			mode: 'delta'
		});
		scheduler.drain();
		host.handle({ type: 'toggle', id: 2, componentId: switchId });
		scheduler.drain();
		const elapsed = performance.now() - started;

		expect(host.recorder.valueAt(outputNet, host.tick)).toBe(1);
		expect(elapsed).toBeLessThan(250);
	});
});
