import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { resolveComponentKind } from '../../engine/kinds';
import { PROTOCOL_VERSION, type CompileErrorEvent, type ReadyEvent, type SimulationEvent } from '../protocol';
import { SimulationHost } from '../session';
import { ManualScheduler } from './fakeWorker';

function document(components: CircuitDocument['components']): CircuitDocument {
	return { schemaVersion: 1, components };
}

function prefixedNets(
	id: string,
	kind: { inputs: readonly string[]; outputs: readonly string[] }
): { inputs: Record<string, string>; outputs: Record<string, string> } {
	const inputs: Record<string, string> = {};
	for (const pin of kind.inputs) inputs[pin] = `${id}_${pin}`;
	const outputs: Record<string, string> = {};
	for (const pin of kind.outputs) outputs[pin] = `${id}_${pin}`;
	return { inputs, outputs };
}

function makeHost(events: SimulationEvent[]) {
	const scheduler = new ManualScheduler();
	const host = new SimulationHost((event) => events.push(event), { schedule: scheduler.schedule });
	return { host, scheduler, events };
}

describe('parameterized session init (U3)', () => {
	it('inits two components sharing one kind with different params independently', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		const narrow = resolveComponentKind('register', { width: 4 })!;
		const wide = resolveComponentKind('register', { width: 8 })!;
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'r1', kind: 'register', params: { width: 4 }, ...prefixedNets('r1', narrow) },
				{ id: 'r2', kind: 'register', params: { width: 8 }, ...prefixedNets('r2', wide) }
			])
		});
		scheduler.drain();
		const ready = events.find((event) => event.type === 'ready') as ReadyEvent | undefined;
		expect(ready).toBeDefined();
		expect(events.some((event) => event.type === 'compileError')).toBe(false);
		expect(ready?.nets).toContain('r1_q3');
		expect(ready?.nets).toContain('r2_q7');
		expect(ready?.nets).not.toContain('r1_q7');
	});

	it('inits a 32-bit adder through the session with all wide nets', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		const kind = resolveComponentKind('rippleCarryAdder', { width: 32 })!;
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'adder', kind: 'rippleCarryAdder', params: { width: 32 }, ...prefixedNets('adder', kind) }
			])
		});
		scheduler.drain();
		const ready = events.find((event) => event.type === 'ready') as ReadyEvent | undefined;
		expect(ready).toBeDefined();
		expect(ready?.nets).toContain('adder_s31');
		expect(ready?.nets).toContain('adder_cout');
	});

	it('keeps documents without parameterized kinds unchanged (AE4)', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'inv', kind: 'not', inputs: { a: 'A' }, outputs: { out: 'OUT' } }
			]),
			mode: 'delta'
		});
		scheduler.drain();
		const ready = events.find((event) => event.type === 'ready') as ReadyEvent | undefined;
		expect(ready).toBeDefined();
		expect(ready?.nets).toContain('OUT');
		expect(host.recorder.valueAt('OUT', 0)).toBe(1);
	});

	it('names the component and pin for a 16-bit register with one unconnected pin and stays not-ready', () => {
		const events: SimulationEvent[] = [];
		const { host } = makeHost(events);
		const kind = resolveComponentKind('register', { width: 16 })!;
		const nets = prefixedNets('reg', kind);
		const { d15: _dropped, ...inputs } = nets.inputs;
		void _dropped;
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'reg', kind: 'register', params: { width: 16 }, inputs, outputs: nets.outputs }
			])
		});
		const error = events.find((event) => event.type === 'compileError') as CompileErrorEvent | undefined;
		expect(error).toBeDefined();
		expect(events.some((event) => event.type === 'ready')).toBe(false);
		const combined = (error?.issues ?? []).map((issue) => issue.message).join('\n');
		expect(combined).toContain('reg');
		expect(combined).toContain('d15');
		expect(error?.issues.some((issue) => (issue.componentIds ?? []).includes('reg'))).toBe(true);
	});

	it('truncates long pin lists with a count remainder', () => {
		const events: SimulationEvent[] = [];
		const { host } = makeHost(events);
		const kind = resolveComponentKind('register', { width: 16 })!;
		const nets = prefixedNets('reg', kind);
		const inputs: Record<string, string> = { clk: nets.inputs['clk'] };
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'reg', kind: 'register', params: { width: 16 }, inputs, outputs: nets.outputs }
			])
		});
		const error = events.find((event) => event.type === 'compileError') as CompileErrorEvent | undefined;
		expect(error).toBeDefined();
		const combined = (error?.issues ?? []).map((issue) => issue.message).join('\n');
		expect(combined).toContain('reg');
		expect(/\+\d+ more|and \d+ more/i.test(combined)).toBe(true);
	});

	it('returns fresh unknown state after a width change re-init', () => {
		const events: SimulationEvent[] = [];
		const { host, scheduler } = makeHost(events);
		const narrow = resolveComponentKind('ram', { addressBits: 2, wordBits: 4 })!;
		host.handle({
			type: 'init',
			id: 1,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'ram', kind: 'ram', params: { addressBits: 2, wordBits: 4 }, ...prefixedNets('ram', narrow) }
			])
		});
		scheduler.drain();
		expect(events.some((event) => event.type === 'ready')).toBe(true);
		const firstTick = host.tick;

		events.length = 0;
		const wide = resolveComponentKind('ram', { addressBits: 2, wordBits: 8 })!;
		host.handle({
			type: 'init',
			id: 2,
			protocolVersion: PROTOCOL_VERSION,
			document: document([
				{ id: 'ram', kind: 'ram', params: { addressBits: 2, wordBits: 8 }, ...prefixedNets('ram', wide) }
			])
		});
		scheduler.drain();
		const ready = events.find((event) => event.type === 'ready') as ReadyEvent | undefined;
		expect(ready).toBeDefined();
		expect(host.tick).toBe(firstTick);
		expect(ready?.nets).toContain('ram_q7');
		expect(host.recorder.valueAt('ram_q7', 0)).toBe('X');
	});
});
