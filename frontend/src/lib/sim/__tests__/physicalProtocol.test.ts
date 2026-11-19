import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import {
	PROTOCOL_VERSION,
	type DiagnosticEvent,
	type SimulationEvent,
	type StatusEvent
} from '../protocol';
import { SimulationHost } from '../session';
import { ManualScheduler } from './fakeWorker';

function makeHost(events: SimulationEvent[], maxPhysicalEvents?: number) {
	const scheduler = new ManualScheduler();
	const host = new SimulationHost((event) => events.push(event), {
		schedule: scheduler.schedule,
		runSchedule: scheduler.schedule,
		maxPhysicalEvents
	});
	return { host, scheduler, events };
}

function lastStatus(events: SimulationEvent[]): StatusEvent | undefined {
	return [...events].reverse().find((event) => event.type === 'status') as StatusEvent | undefined;
}

function clockDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		components: [{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } }]
	};
}

function setupViolationDocument(): CircuitDocument {
	return {
		schemaVersion: 1,
		components: [
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
			{
				id: 'delay',
				kind: 'buffer',
				params: { delay: 19 },
				inputs: { a: 'CLK' },
				outputs: { out: 'D' }
			},
			{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
		]
	};
}

function init(host: SimulationHost, document: CircuitDocument): void {
	host.handle({
		type: 'init',
		id: 1,
		protocolVersion: PROTOCOL_VERSION,
		document,
		mode: 'physical'
	});
}

describe('physical protocol and host', () => {
	it('reports physical mode and steps to the next timestamp', () => {
		const { host, scheduler, events } = makeHost([]);
		init(host, clockDocument());
		scheduler.drain();
		expect(host.tick).toBe(0);
		expect(host.recorder.valueAt('CLK', 0)).toBe(0);

		host.handle({ type: 'step', id: 2 });
		scheduler.drain();
		expect(host.tick).toBe(10_000);
		expect(host.recorder.valueAt('CLK', 10_000)).toBe(1);
		expect(lastStatus(events)?.mode).toBe('physical');
	});

	it('emits a values frame for each timestamp without overwriting the pulse', () => {
		const { host, scheduler, events } = makeHost([]);
		init(host, clockDocument());
		scheduler.drain();
		events.length = 0;
		host.handle({ type: 'step', id: 2, ticks: 3 });
		scheduler.drain();
		const values = events.filter((event) => event.type === 'values');
		expect(values.length).toBeGreaterThanOrEqual(3);
		expect(new Set(values.map((event) => event.tick))).toEqual(new Set([10_000, 20_000, 30_000]));
	});

	it('reports setup timing with component, edge, and absolute window', () => {
		const { host, scheduler, events } = makeHost([]);
		init(host, setupViolationDocument());
		scheduler.drain();
		host.handle({ type: 'step', id: 2, ticks: 6 });
		scheduler.drain();
		const diagnostic = events.find(
			(event) => event.type === 'diagnostic' && event.diagnostic.kind === 'timing'
		) as DiagnosticEvent | undefined;
		expect(diagnostic).toBeDefined();
		expect(diagnostic?.diagnostic).toMatchObject({
			id: 'timing:setup:ff',
			kind: 'timing',
			componentIds: ['ff'],
			time: 30_000,
			window: { from: 28_000, to: 30_000 }
		});
	});

	it('pauses Run on the first new timing diagnostic', () => {
		const { host, scheduler, events } = makeHost([]);
		init(host, setupViolationDocument());
		scheduler.drain();
		host.handle({ type: 'run', id: 2 });
		scheduler.drain();
		const status = lastStatus(events);
		expect(status?.running).toBe(false);
		expect(status?.pauseReason).toBe('timing');
	});

	it('keeps Pause reachable between physical Run turns', () => {
		const { host, scheduler, events } = makeHost([]);
		init(host, clockDocument());
		scheduler.drain();
		host.handle({ type: 'run', id: 2 });
		scheduler.fireAll();
		host.handle({ type: 'pause', id: 3 });
		scheduler.drain();
		const status = lastStatus(events);
		expect(status?.running).toBe(false);
		expect(status?.pauseReason).toBeUndefined();
	});

	it('stops on the event cap with its own diagnostic and pause reason', () => {
		const { host, scheduler, events } = makeHost([], 1);
		init(host, setupViolationDocument());
		scheduler.drain();
		const diagnostic = events.find(
			(event) => event.type === 'diagnostic' && event.diagnostic.kind === 'event-limit'
		) as DiagnosticEvent | undefined;
		expect(diagnostic).toBeDefined();
		expect(lastStatus(events)?.pauseReason).toBe('event-limit');
	});

	it('resets physical time and clears the timing dedupe state', () => {
		const { host, scheduler } = makeHost([]);
		init(host, setupViolationDocument());
		scheduler.drain();
		host.handle({ type: 'step', id: 2, ticks: 6 });
		scheduler.drain();
		expect(host.tick).toBe(30_000);
		host.handle({ type: 'reset', id: 3 });
		scheduler.drain();
		expect(host.tick).toBe(0);
		expect(host.recorder.valueAt('Q', 0)).toBe('X');
	});
});
