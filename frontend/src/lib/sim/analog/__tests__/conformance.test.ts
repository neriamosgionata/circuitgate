import { describe, expect, it } from 'vitest';

import type { CircuitDocument } from '../../../model/circuit';
import { FakeWorker, ManualScheduler } from '../../__tests__/fakeWorker';
import { DiagnosticsStore } from '../../diagnostics';
import {
	PROTOCOL_VERSION,
	isSimulationCommand,
	isSimulationEvent,
	type SimulationCommand,
	type SimulationEvent
} from '../../protocol';
import { SimulationHost, WorkerSimulationSession } from '../../session';
import {
	ANALOG_PROTOCOL_VERSION,
	isAnalogCommand,
	isAnalogEvent,
	type AnalogCommand,
	type AnalogDiagnosticEvent,
	type AnalogEvent
} from '../protocol';
import { AnalogHost, AnalogWorkerSession } from '../session';

/**
 * Cross-protocol conformance: the digital and analog transports are separate
 * implementations, but they must hold the same id, correlation, and
 * versioning invariants (KTD2).
 */

interface SessionHandle {
	send(command: unknown): void;
	dispose(): void;
}

interface ConformanceAdapter {
	name: string;
	version: number;
	initializeType: string;
	isCommand(value: unknown): boolean;
	isEvent(value: unknown): boolean;
	unsupportedVersionEvents(): Array<{ type: string; code?: string }>;
	createSession(): { session: SessionHandle; workers: FakeWorker[]; events: unknown[] };
	readyEvent(correlationId: number): unknown;
	runCommand(id: number): unknown;
	hasRunOutput(events: Array<{ type: string }>): boolean;
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

const digitalAdapter: ConformanceAdapter = {
	name: 'digital',
	version: PROTOCOL_VERSION,
	initializeType: 'init',
	isCommand: isSimulationCommand,
	isEvent: isSimulationEvent,
	unsupportedVersionEvents() {
		const events: SimulationEvent[] = [];
		const scheduler = new ManualScheduler();
		const host = new SimulationHost((event) => events.push(event), { schedule: scheduler.schedule });
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION + 1,
			document: simpleDocument()
		});
		host.handle({ type: 'run', id: 2 });
		scheduler.drain();
		return events.map((event) =>
			event.type === 'compileError'
				? { type: event.type, code: event.issues[0]?.code }
				: { type: event.type }
		);
	},
	createSession() {
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
		return {
			session: {
				send: (command) => session.send(command as SimulationCommand),
				dispose: () => session.dispose()
			},
			workers,
			events
		};
	},
	readyEvent(correlationId) {
		return { type: 'ready', correlationId, mode: 'delta', nets: [], components: [] };
	},
	runCommand(id) {
		return { type: 'run', id };
	},
	hasRunOutput(events) {
		return events.some(
			(event) =>
				event.type === 'values' ||
				event.type === 'history' ||
				event.type === 'ready' ||
				event.type === 'result'
		);
	}
};

const analogAdapter: ConformanceAdapter = {
	name: 'analog',
	version: ANALOG_PROTOCOL_VERSION,
	initializeType: 'initialize',
	isCommand: isAnalogCommand,
	isEvent: isAnalogEvent,
	unsupportedVersionEvents() {
		const events: AnalogEvent[] = [];
		const host = new AnalogHost(
			(event) => events.push(event),
			async () => ({ variables: [] })
		);
		host.handle({ type: 'initialize', id: 1, protocolVersion: ANALOG_PROTOCOL_VERSION + 1 });
		host.handle({
			type: 'run',
			id: 2,
			analyses: [{ id: 'op1', kind: 'op', deck: '* op\n' }]
		});
		return events.map((event) =>
			event.type === 'diagnostic'
				? { type: event.type, code: (event as AnalogDiagnosticEvent).diagnostic.code }
				: { type: event.type }
		);
	},
	createSession() {
		const workers: FakeWorker[] = [];
		const events: AnalogEvent[] = [];
		const session = new AnalogWorkerSession({
			createWorker: () => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			onEvent: (event: AnalogEvent) => events.push(event)
		});
		return {
			session: {
				send: (command) => session.send(command as AnalogCommand),
				dispose: () => session.dispose()
			},
			workers,
			events
		};
	},
	readyEvent(correlationId) {
		return { type: 'ready', correlationId };
	},
	runCommand(id) {
		return { type: 'run', id, analyses: [{ id: 'op1', kind: 'op', deck: '* op\n' }] };
	},
	hasRunOutput(events) {
		return events.some((event) => event.type === 'result' || event.type === 'ready');
	}
};

for (const adapter of [digitalAdapter, analogAdapter]) {
	describe(`${adapter.name} transport conformance`, () => {
		it('declares a positive integer protocol version', () => {
			expect(Number.isInteger(adapter.version)).toBe(true);
			expect(adapter.version).toBeGreaterThan(0);
		});

		it('rejects unknown commands and events', () => {
			expect(adapter.isCommand({ type: 'teleport', id: 1 })).toBe(false);
			expect(adapter.isCommand({ type: 'run' })).toBe(false);
			expect(adapter.isCommand(null)).toBe(false);
			expect(adapter.isEvent({ type: 'teleported' })).toBe(false);
			expect(adapter.isEvent({})).toBe(false);
			expect(adapter.isEvent(null)).toBe(false);
		});

		it('reports an unsupported protocol version and produces no run output', () => {
			const events = adapter.unsupportedVersionEvents();
			expect(events.some((event) => event.code === 'unsupported-protocol')).toBe(true);
			expect(adapter.hasRunOutput(events)).toBe(false);
		});

		it('sends a versioned initialize command and correlates the ready response', () => {
			const { session, workers, events } = adapter.createSession();
			const init = workers[0].messages[0] as { type: string; id: number; protocolVersion: number };
			expect(init.type).toBe(adapter.initializeType);
			expect(init.protocolVersion).toBe(adapter.version);
			expect(init.id).toBe(1);

			workers[0].emit(adapter.readyEvent(init.id));
			const ready = (events as Array<{ type: string; correlationId?: number }>).find(
				(event) => event.type === 'ready'
			);
			expect(ready?.correlationId).toBe(init.id);

			session.send(adapter.runCommand(2));
			const ids = workers[0].messages.map((message) => (message as { id: number }).id);
			expect(ids).toEqual([1, 2]);
			session.dispose();
		});

		it('respawns a crashed worker, emits restarted before ready, and stays usable', () => {
			const { session, workers, events } = adapter.createSession();
			const firstInit = workers[0].messages[0] as { id: number };
			workers[0].emit(adapter.readyEvent(firstInit.id));

			workers[0].fail('worker crashed');

			expect(workers[0].terminated).toBe(true);
			expect(workers).toHaveLength(2);
			const restarted = (events as Array<{ type: string }>).findIndex(
				(event) => event.type === 'restarted'
			);
			expect(restarted).toBeGreaterThanOrEqual(0);

			const respawnInit = workers[1].messages[0] as {
				type: string;
				id: number;
				protocolVersion: number;
			};
			expect(respawnInit.type).toBe(adapter.initializeType);
			expect(respawnInit.protocolVersion).toBe(adapter.version);
			workers[1].emit(adapter.readyEvent(respawnInit.id));
			const afterRestart = (events as Array<{ type: string }>).slice(restarted + 1);
			expect(afterRestart.some((event) => event.type === 'ready')).toBe(true);

			session.send(adapter.runCommand(2));
			expect((workers[1].lastMessage as { type: string }).type).toBe('run');
			session.dispose();
		});
	});
}

describe('digital diagnostics store stays protocol-agnostic', () => {
	it('accepts an analog protocol diagnostic without digital changes', () => {
		const store = new DiagnosticsStore();
		const added = store.add({
			id: 'analog:worker-timeout:0',
			kind: 'protocol',
			code: 'worker-timeout',
			message: 'no progress for 30001 ms'
		});
		expect(added).toBe(true);
		expect(store.list()[0].code).toBe('worker-timeout');
		store.clear();
		expect(store.size).toBe(0);
	});
});
