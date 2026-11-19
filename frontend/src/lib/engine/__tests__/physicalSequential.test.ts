import { describe, expect, it } from 'vitest';
import { CompileError } from '../compile';
import { resolveComponentKind } from '../kinds';
import { PhysicalSimulator, type PhysicalTimingEvent } from '../physical';
import { timingForComponent } from '../timing';
import { document } from './helpers';

const resolver = (kind: string, params?: Record<string, unknown>) =>
	resolveComponentKind(kind, params);
const timingResolver = (kind: string, params?: Record<string, unknown>) =>
	timingForComponent(kind, params);

function physical(components: Parameters<typeof document>[0]): PhysicalSimulator {
	return new PhysicalSimulator(document(components), resolver, {}, timingResolver);
}

function runCollect(sim: PhysicalSimulator, untilPs: number): PhysicalTimingEvent[] {
	const events: PhysicalTimingEvent[] = [];
	let guard = 0;
	while (sim.timePs < untilPs && guard < 200) {
		const result = sim.stepPhysical();
		events.push(...result.timingEvents);
		if (result.status !== 'stable') break;
		guard += 1;
	}
	return events;
}

function dffWithDataDelay(delay: number): PhysicalSimulator {
	return physical([
		{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
		{
			id: 'delay',
			kind: 'buffer',
			params: { delay },
			inputs: { a: 'CLK' },
			outputs: { out: 'D' }
		},
		{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
	]);
}

describe('sequential physical timing', () => {
	it('drives X and reports setup when data arrives inside the setup window', () => {
		const sim = dffWithDataDelay(19);
		const events = runCollect(sim, 34_000);
		expect(events).toContainEqual({
			componentId: 'ff',
			constraint: 'setup',
			edgeTimePs: 30_000,
			windowFromPs: 28_000,
			windowToPs: 30_000
		});
		expect(sim.getNet('Q')).toBe('X');
		expect(sim.getNet('QN')).toBe('X');
	});

	it('drives X and reports hold when data changes after the edge', () => {
		const sim = dffWithDataDelay(20.5);
		const events = runCollect(sim, 34_000);
		expect(events).toContainEqual({
			componentId: 'ff',
			constraint: 'hold',
			edgeTimePs: 30_000,
			windowFromPs: 30_000,
			windowToPs: 31_000
		});
		expect(sim.getNet('Q')).toBe('X');
	});

	it('applies clock-to-Q after the hold window', () => {
		const sim = physical([
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
			{ id: 'd', kind: 'switch', initialState: { value: 1 }, inputs: {}, outputs: { out: 'D' } },
			{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
		]);
		runCollect(sim, 10_000);
		expect(sim.getNet('Q')).toBe('X');
		runCollect(sim, 14_000);
		expect(sim.getNet('Q')).toBe(1);
	});

	it('does not report X or Z data as a timing violation', () => {
		const sim = physical([
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
			{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
		]);
		const events = runCollect(sim, 14_000);
		expect(events).toEqual([]);
		expect(sim.getNet('Q')).toBe('X');
	});

	it('treats a transition exactly on the setup boundary as a violation', () => {
		const sim = dffWithDataDelay(18);
		const events = runCollect(sim, 34_000);
		expect(events.some((event) => event.constraint === 'setup')).toBe(true);
		expect(sim.getNet('Q')).toBe('X');
	});

	it('does not diagnose a pre-edge transition at the first active edge', () => {
		const sim = physical([
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
			{ id: 'src', kind: 'switch', initialState: { value: 0 }, inputs: {}, outputs: { out: 'SRC' } },
			{
				id: 'delay',
				kind: 'buffer',
				params: { delay: 8.5 },
				inputs: { a: 'SRC' },
				outputs: { out: 'D' }
			},
			{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
		]);
		sim.setState('src', { value: 1 });
		sim.wakePhysical('src');
		const events = runCollect(sim, 10_000);
		expect(events).toEqual([]);
	});

	it('recovers a DFF on the next compliant edge', () => {
		const sim = physical([
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
			{ id: 'src', kind: 'switch', initialState: { value: 0 }, inputs: {}, outputs: { out: 'SRC' } },
			{
				id: 'delay',
				kind: 'buffer',
				params: { delay: 9 },
				inputs: { a: 'SRC' },
				outputs: { out: 'D' }
			},
			{ id: 'ff', kind: 'dFlipFlop', inputs: { d: 'D', clk: 'CLK' }, outputs: { q: 'Q', qn: 'QN' } }
		]);
		runCollect(sim, 10_000);
		runCollect(sim, 20_000);
		sim.setState('src', { value: 1 });
		sim.wakePhysical('src');
		const violation = runCollect(sim, 30_000);
		expect(violation.some((event) => event.constraint === 'setup')).toBe(true);
		runCollect(sim, 34_000);
		expect(sim.getNet('Q')).toBe('X');
		runCollect(sim, 54_000);
		expect(sim.getNet('Q')).toBe(1);
	});

	it('keeps a counter X after a violation until load or reset', () => {
		const sim = physical([
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } },
			{ id: 'rst', kind: 'switch', initialState: { value: 0 }, inputs: {}, outputs: { out: 'RST' } },
			{ id: 'en', kind: 'switch', initialState: { value: 1 }, inputs: {}, outputs: { out: 'EN' } },
			{ id: 'load', kind: 'switch', initialState: { value: 0 }, inputs: {}, outputs: { out: 'LOAD' } },
			{ id: 'src', kind: 'switch', initialState: { value: 0 }, inputs: {}, outputs: { out: 'SRC' } },
			{
				id: 'delay',
				kind: 'buffer',
				params: { delay: 9 },
				inputs: { a: 'SRC' },
				outputs: { out: 'D0' }
			},
			{
				id: 'ctr',
				kind: 'counter',
				params: { width: 1 },
				inputs: { clk: 'CLK', reset: 'RST', enable: 'EN', load: 'LOAD', d0: 'D0' },
				outputs: { q0: 'Q0' }
			}
		]);
		runCollect(sim, 10_000);
		runCollect(sim, 20_000);
		sim.setState('src', { value: 1 });
		sim.wakePhysical('src');
		const violation = runCollect(sim, 30_000);
		expect(violation.some((event) => event.constraint === 'setup')).toBe(true);
		runCollect(sim, 34_000);
		expect(sim.getNet('Q0')).toBe('X');
		runCollect(sim, 50_000);
		expect(sim.getNet('Q0')).toBe('X');
	});

	it('rejects a clock period that cannot fit a capture', () => {
		expect(
			() =>
				new PhysicalSimulator(
					document([
						{ id: 'clk', kind: 'clock', params: { period: 5 }, inputs: {}, outputs: { out: 'CLK' } },
						{
							id: 'ff',
							kind: 'dFlipFlop',
							inputs: { d: 'D', clk: 'CLK' },
							outputs: { q: 'Q', qn: 'QN' }
						}
					]),
					resolver,
					{},
					timingResolver
				)
		).toThrow(CompileError);
	});
});
