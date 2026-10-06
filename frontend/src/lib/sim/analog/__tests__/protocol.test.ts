import { describe, expect, it, vi } from 'vitest';

import { FakeWorker, ManualScheduler } from '../../__tests__/fakeWorker';
import {
	ANALOG_PROTOCOL_VERSION,
	isAnalogCommand,
	isAnalogEvent,
	type AnalogAnalysisKind,
	type AnalogAnalysisRequest,
	type AnalogCommand,
	type AnalogDiagnosticEvent,
	type AnalogEvent,
	type AnalogInitializeCommand,
	type AnalogProgressEvent,
	type AnalogResultEvent,
	type AnalogResultVariable,
	type AnalogRunCommand
} from '../protocol';
import {
	AnalogHost,
	AnalogResultsStore,
	AnalogWorkerSession,
	type AnalogAnalysisOutcome,
	type AnalogRunner
} from '../session';

function analysis(id: string, kind: AnalogAnalysisKind): AnalogAnalysisRequest {
	return { id, kind, deck: `* ${id} ${kind} deck\n` };
}

function initialize(id = 1): AnalogCommand {
	return { type: 'initialize', id, protocolVersion: ANALOG_PROTOCOL_VERSION };
}

function run(id: number, analyses: AnalogAnalysisRequest[] = [analysis('op1', 'op')]): AnalogCommand {
	const command: AnalogRunCommand = { type: 'run', id, analyses };
	return command;
}

function variable(name: string): AnalogResultVariable {
	return { name, type: 'voltage', real: Float64Array.from([1, 2, 3]) };
}

function result(id: number, analysisId: string, kind: AnalogAnalysisKind = 'tran'): AnalogResultEvent {
	return {
		type: 'result',
		correlationId: id,
		analysisId,
		kind,
		variables: [variable('v(1)')],
		engineDiagnostics: [],
		durationMs: 1
	};
}

function fakeClock(start = 0) {
	let time = start;
	return {
		now: () => time,
		advance: (ms: number) => {
			time += ms;
		}
	};
}

function codes(events: AnalogEvent[]): string[] {
	return events
		.filter((event): event is AnalogDiagnosticEvent => event.type === 'diagnostic')
		.map((event) => event.diagnostic.code ?? '');
}

function afterRestartNextEvent(events: AnalogEvent[], restartIndex: number): AnalogEvent | undefined {
	return events.slice(restartIndex + 1).find((event) => event.type !== 'restarted');
}

describe('analog protocol guards', () => {
	it('accepts the command and event vocabulary and rejects junk', () => {
		expect(isAnalogCommand(initialize(1))).toBe(true);
		expect(isAnalogCommand(run(2))).toBe(true);
		expect(isAnalogCommand({ type: 'cancel', id: 3 })).toBe(true);
		expect(isAnalogCommand({ type: 'dispose', id: 4 })).toBe(true);
		expect(isAnalogCommand({ type: 'step', id: 5 })).toBe(false);
		expect(isAnalogCommand({ type: 'run' })).toBe(false);
		expect(isAnalogCommand({ type: 'run', id: Number.NaN })).toBe(false);
		expect(isAnalogCommand(null)).toBe(false);

		expect(isAnalogEvent({ type: 'ready', correlationId: 1 })).toBe(true);
		expect(isAnalogEvent({ type: 'restarted', reason: 'crash' })).toBe(true);
		expect(
			isAnalogEvent({ type: 'progress', phase: 'solving', elapsedMs: 1, indeterminate: true })
		).toBe(true);
		expect(
			isAnalogEvent({
				type: 'diagnostic',
				diagnostic: { id: 'x', kind: 'protocol', message: 'm' }
			})
		).toBe(true);
		expect(isAnalogEvent(result(2, 'op1', 'op'))).toBe(true);
		expect(isAnalogEvent({ type: 'values' })).toBe(false);
		expect(isAnalogEvent({ type: 'result', correlationId: 2, analysisId: 'op1', variables: [] })).toBe(
			false
		);
		expect(
			isAnalogEvent({
				type: 'result',
				correlationId: 2,
				analysisId: 'op1',
				kind: 'op',
				variables: [{ name: 'v(1)', type: 'voltage', real: [1, 2, 3] }],
				engineDiagnostics: [],
				durationMs: 1
			})
		).toBe(false);
		expect(isAnalogEvent(null)).toBe(false);
	});
});

describe('analog host lifecycle', () => {
	it('emits ready for initialize without touching the engine', () => {
		const events: AnalogEvent[] = [];
		let runnerCalls = 0;
		const runner: AnalogRunner = async () => {
			runnerCalls += 1;
			return { variables: [] };
		};
		const host = new AnalogHost((event) => events.push(event), runner);

		host.handle(initialize(7));

		expect(events).toEqual([{ type: 'ready', correlationId: 7 }]);
		expect(runnerCalls).toBe(0);
	});

	it('rejects an unsupported protocol version and refuses to run', () => {
		const events: AnalogEvent[] = [];
		const runner: AnalogRunner = async () => ({ variables: [variable('v(1)')] });
		const host = new AnalogHost((event) => events.push(event), runner);

		host.handle({ type: 'initialize', id: 3, protocolVersion: ANALOG_PROTOCOL_VERSION + 1 });

		expect(events.some((event) => event.type === 'ready')).toBe(false);
		expect(codes(events)).toContain('unsupported-protocol');

		host.handle(run(4));
		expect(codes(events)).toContain('not-initialized');
		expect(events.some((event) => event.type === 'result')).toBe(false);
	});

	it('treats a missing protocol version as unsupported', () => {
		const events: AnalogEvent[] = [];
		const host = new AnalogHost(
			(event) => events.push(event),
			async () => ({ variables: [] })
		);
		host.handle({ type: 'initialize', id: 1 } as AnalogCommand);
		expect(codes(events)).toContain('unsupported-protocol');
	});

	it('stops handling commands after dispose', () => {
		const events: AnalogEvent[] = [];
		const host = new AnalogHost(
			(event) => events.push(event),
			async () => ({ variables: [] })
		);
		host.handle(initialize(1));
		host.handle({ type: 'dispose', id: 2 });
		host.handle(run(3));
		expect(events).toEqual([{ type: 'ready', correlationId: 1 }]);
	});

	it('runs an analysis set in order with correlated, typed-array results', async () => {
		const events: AnalogEvent[] = [];
		const seen: string[] = [];
		const runner: AnalogRunner = async (request, report) => {
			seen.push(request.id);
			report({ phase: 'solving' });
			const outcome: AnalogAnalysisOutcome = {
				variables: [variable(`v(${request.id})`)],
				engineDiagnostics: [],
				durationMs: 2
			};
			return outcome;
		};
		const host = new AnalogHost((event) => events.push(event), runner, { now: () => 0 });

		host.handle(initialize(1));
		host.handle(run(2, [analysis('op1', 'op'), analysis('tran1', 'tran')]));

		await vi.waitFor(() => {
			expect(events.filter((event) => event.type === 'result')).toHaveLength(2);
		});
		expect(seen).toEqual(['op1', 'tran1']);

		const results = events.filter((event): event is AnalogResultEvent => event.type === 'result');
		expect(results.map((event) => event.correlationId)).toEqual([2, 2]);
		expect(results.map((event) => event.analysisId)).toEqual(['op1', 'tran1']);
		expect(results[0].kind).toBe('op');
		expect(results[0].variables[0].real).toBeInstanceOf(Float64Array);
		expect(results[0].variables[0].real.length).toBe(3);

		const progress = events.filter(
			(event): event is AnalogProgressEvent => event.type === 'progress'
		);
		expect(progress.length).toBeGreaterThan(0);
		expect(progress.every((event) => event.correlationId === 2)).toBe(true);
		expect(progress.every((event) => event.indeterminate)).toBe(true);
		expect(progress[0].analysisId).toBe('op1');
	});

	it('isolates a failing analysis from the rest of the set', async () => {
		const events: AnalogEvent[] = [];
		const runner: AnalogRunner = async (request) => {
			if (request.id === 'bad') throw new Error('no convergence');
			return { variables: [variable('v(1)')] };
		};
		const host = new AnalogHost((event) => events.push(event), runner);
		host.handle(initialize(1));
		host.handle(run(2, [analysis('bad', 'op'), analysis('good', 'op')]));

		await vi.waitFor(() => {
			expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
		});
		const failure = events.find(
			(event) => event.type === 'diagnostic' && event.diagnostic.code === 'analysis-failed'
		) as AnalogDiagnosticEvent | undefined;
		expect(failure).toBeDefined();
		expect(failure?.diagnostic.message).toContain('no convergence');
	});

	it('coalesces worker-side progress to at most one event per interval', () => {
		const events: AnalogEvent[] = [];
		const scheduler = new ManualScheduler();
		const runner: AnalogRunner = async (_request, report) => {
			for (let index = 0; index < 1000; index++) report({ phase: 'solving' });
			return { variables: [] };
		};
		const host = new AnalogHost((event) => events.push(event), runner, {
			now: () => 0,
			schedule: scheduler.schedule,
			progressIntervalMs: 100
		});
		host.handle(initialize(1));
		host.handle(run(2));

		const forwarded = events.filter((event) => event.type === 'progress');
		expect(forwarded.length).toBeLessThanOrEqual(2);
	});
});

describe('analog worker session', () => {
	function makeSession(overrides: Partial<ConstructorParameters<typeof AnalogWorkerSession>[0]> = {}) {
		const workers: FakeWorker[] = [];
		const events: AnalogEvent[] = [];
		const results = new AnalogResultsStore();
		const session = new AnalogWorkerSession({
			createWorker: () => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			onEvent: (event) => events.push(event),
			results,
			...overrides
		});
		return { session, workers, events, results };
	}

	function ready(worker: FakeWorker): AnalogInitializeCommand {
		const init = worker.messages[0] as AnalogInitializeCommand;
		worker.emit({ type: 'ready', correlationId: init.id });
		return init;
	}

	it('initializes with a versioned command and monotonic command ids', () => {
		const { session, workers } = makeSession();

		const init = workers[0].messages[0] as AnalogInitializeCommand;
		expect(init.type).toBe('initialize');
		expect(init.protocolVersion).toBe(ANALOG_PROTOCOL_VERSION);
		expect(init.id).toBe(1);

		ready(workers[0]);
		session.send(run(2));
		session.send({ type: 'cancel', id: 3 });

		const ids = [1, ...workers[0].messages.slice(1).map((message) => (message as { id: number }).id)];
		expect(ids[0]).toBe(1);
		expect(new Set(ids).size).toBe(ids.length);
		session.dispose();
	});

	it('cancels a run by terminating the worker, then serves the next run', () => {
		const { session, workers, events } = makeSession();
		ready(workers[0]);
		session.send(run(2, [analysis('tran1', 'tran')]));
		workers[0].emit({ type: 'progress', correlationId: 2, analysisId: 'tran1', phase: 'solving', elapsedMs: 1, indeterminate: true });

		const started = performance.now();
		session.send({ type: 'cancel', id: 3 });

		expect(workers[0].terminated).toBe(true);
		expect(workers).toHaveLength(2);
		expect(codes(events)).toContain('cancelled');
		expect(events.some((event) => event.type === 'result')).toBe(false);

		ready(workers[1]);
		session.send(run(4, [analysis('tran2', 'tran')]));
		expect((workers[1].lastMessage as { type: string }).type).toBe('run');
		workers[1].emit(result(4, 'tran2'));

		const delivered = events.find((event) => event.type === 'result') as AnalogResultEvent;
		expect(delivered.correlationId).toBe(4);
		expect(performance.now() - started).toBeLessThan(10_000);
		session.dispose();
	});

	it('keeps completed typed-array results in the main-thread store after disposal', () => {
		const { session, workers, results } = makeSession();
		ready(workers[0]);
		session.send(run(2, [analysis('tran1', 'tran')]));
		workers[0].emit(result(2, 'tran1'));

		const stored = results.get('tran1');
		expect(stored).toBeDefined();
		expect(stored?.variables[0].real).toBeInstanceOf(Float64Array);

		session.dispose();
		expect(session.disposed).toBe(true);
		expect(workers[0].terminated).toBe(true);
		expect(results.get('tran1')).toBeDefined();
	});

	it('respawns after a crash, emits restarted then a diagnostic before ready, and runs again', () => {
		const { session, workers, events } = makeSession();
		ready(workers[0]);

		workers[0].fail('worker crashed');

		expect(workers[0].terminated).toBe(true);
		expect(workers).toHaveLength(2);
		expect(codes(events)).toContain('worker-crash');
		const restartIndex = events.findIndex((event) => event.type === 'restarted');
		expect(restartIndex).toBeGreaterThanOrEqual(0);
		expect(afterRestartNextEvent(events, restartIndex)?.type).toBe('diagnostic');

		ready(workers[1]);
		session.send(run(2));
		expect((workers[1].lastMessage as { type: string }).type).toBe('run');
		session.dispose();
	});

	it('classifies an out-of-memory crash with an out-of-memory diagnostic', () => {
		const { workers, events } = makeSession();
		ready(workers[0]);
		workers[0].fail('RangeError: out of memory');
		expect(codes(events)).toContain('out-of-memory');
	});

	it('terminates and respawns when the watchdog deadline passes without progress', () => {
		const clock = fakeClock();
		const scheduler = new ManualScheduler();
		const { session, workers, events } = makeSession({
			watchdogTimeoutMs: 100,
			progressIntervalMs: 100,
			now: clock.now,
			schedule: scheduler.schedule
		});
		ready(workers[0]);
		session.send(run(2, [analysis('tran1', 'tran')]));

		clock.advance(101);
		scheduler.drain();

		expect(workers[0].terminated).toBe(true);
		expect(workers).toHaveLength(2);
		expect(codes(events)).toContain('worker-timeout');
		const restartIndex = events.findIndex((event) => event.type === 'restarted');
		expect(restartIndex).toBeGreaterThanOrEqual(0);
		expect(afterRestartNextEvent(events, restartIndex)?.type).toBe('diagnostic');
		session.dispose();
	});

	it('resets the watchdog deadline on every progress event', () => {
		const clock = fakeClock();
		const scheduler = new ManualScheduler();
		const { session, workers } = makeSession({
			watchdogTimeoutMs: 100,
			progressIntervalMs: 100,
			now: clock.now,
			schedule: scheduler.schedule
		});
		ready(workers[0]);
		session.send(run(2));

		clock.advance(90);
		scheduler.drain();
		expect(workers).toHaveLength(1);

		workers[0].emit({ type: 'progress', correlationId: 2, phase: 'solving', elapsedMs: 90, indeterminate: true });
		clock.advance(90);
		scheduler.drain();
		expect(workers).toHaveLength(1);

		clock.advance(101);
		scheduler.drain();
		expect(workers).toHaveLength(2);
		session.dispose();
	});

	it('coalesces progress events to at most 10 Hz over a long run', () => {
		const clock = fakeClock();
		const scheduler = new ManualScheduler();
		const { session, workers, events } = makeSession({
			progressIntervalMs: 100,
			now: clock.now,
			schedule: scheduler.schedule
		});
		ready(workers[0]);
		session.send(run(2, [analysis('tran1', 'tran')]));

		for (let index = 0; index < 1000; index++) {
			workers[0].emit({
				type: 'progress',
				correlationId: 2,
				analysisId: 'tran1',
				phase: 'solving',
				elapsedMs: index * 10,
				indeterminate: true
			});
			clock.advance(10);
		}
		scheduler.drain();

		const forwarded = events.filter((event) => event.type === 'progress');
		const spanMs = clock.now();
		expect(forwarded.length).toBeLessThanOrEqual(Math.ceil(spanMs / 100) + 2);
		expect(forwarded.length).toBeGreaterThan(2);
		session.dispose();
	});
});
