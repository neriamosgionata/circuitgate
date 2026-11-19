import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import { resolveComponentKind } from '../kinds';
import { flatten, SUB_CIRCUIT_KIND, type SubcircuitDefinition } from '../hierarchy';
import { PhysicalSimulator } from '../physical';
import { timingForComponent } from '../timing';
import { document } from './helpers';

const resolver = (kind: string, params?: Record<string, unknown>) =>
	resolveComponentKind(kind, params);
const timingResolver = (kind: string, params?: Record<string, unknown>) =>
	timingForComponent(kind, params);

function physical(document: CircuitDocument, initialValues?: Record<string, never>): PhysicalSimulator {
	return new PhysicalSimulator(document, resolver, initialValues ?? {}, timingResolver);
}

describe('physical scheduler', () => {
	it('delivers a combinational output after its propagation delay', () => {
		const sim = physical(
			document([
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'buf', kind: 'buffer', inputs: { a: 'A' }, outputs: { out: 'OUT' } }
			])
		);
		sim.setState('sw', { value: 1 });
		let result = sim.stepPhysical();
		expect(result.timePs).toBe(0);
		expect(sim.getNet('OUT')).toBe('X');
		result = sim.stepPhysical();
		expect(result.timePs).toBe(2000);
		expect(sim.getNet('OUT')).toBe(1);
	});

	it('keeps a reconvergent pulse through transport delay', () => {
		const sim = physical(
			document([
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'fast', kind: 'buffer', inputs: { a: 'A' }, outputs: { out: 'FAST' } },
				{ id: 'slow', kind: 'buffer', params: { delay: 5 }, inputs: { a: 'A' }, outputs: { out: 'SLOW' } },
				{ id: 'mix', kind: 'xor', inputs: { a: 'FAST', b: 'SLOW' }, outputs: { out: 'OUT' } }
			])
		);
		sim.setState('sw', { value: 0 });
		sim.stepPhysical();
		while (sim.timePs < 5000) sim.stepPhysical();
		sim.setState('sw', { value: 1 });
		sim.wakePhysical('sw');
		const trace: Array<[number, unknown]> = [];
		for (let step = 0; step < 10; step += 1) {
			const result = sim.stepPhysical();
			trace.push([result.timePs, sim.getNet('OUT')]);
		}
		expect(trace).toContainEqual([9000, 1]);
		expect(trace).toContainEqual([12_000, 0]);
	});

	it('schedules a clock from its period and duty', () => {
		const sim = physical(
			document([{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } }])
		);
		expect(sim.stepPhysical().timePs).toBe(0);
		expect(sim.getNet('CLK')).toBe(0);
		expect(sim.stepPhysical().timePs).toBe(10_000);
		expect(sim.getNet('CLK')).toBe(1);
		expect(sim.stepPhysical().timePs).toBe(20_000);
		expect(sim.getNet('CLK')).toBe(0);
		expect(sim.stepPhysical().timePs).toBe(30_000);
		expect(sim.getNet('CLK')).toBe(1);
	});

	it('preserves a flattened subcircuit delay without a boundary delay', () => {
		const definition: SubcircuitDefinition = {
			name: 'delayedBuffer',
			inputs: { a: 'A' },
			outputs: { out: 'OUT' },
			document: document([
				{
					id: 'buf',
					kind: 'buffer',
					params: { delay: 3 },
					inputs: { a: 'A' },
					outputs: { out: 'OUT' }
				}
			])
		};
		const top = document([
			{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
			{
				id: 'inst',
				kind: SUB_CIRCUIT_KIND,
				params: { definition: 'delayedBuffer' },
				inputs: { a: 'A' },
				outputs: { out: 'OUT' }
			}
		]);
		const sim = physical(flatten(top, { delayedBuffer: definition }, resolveComponentKind));
		sim.setState('sw', { value: 1 });
		expect(sim.stepPhysical().timePs).toBe(0);
		expect(sim.getNet('OUT')).toBe('X');
		expect(sim.stepPhysical().timePs).toBe(3000);
		expect(sim.getNet('OUT')).toBe(1);
	});

	it('stops before applying a timestamp over the event cap', () => {
		const sim = physical(
			document([
				{ id: 'a', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'b', kind: 'switch', inputs: {}, outputs: { out: 'B' } }
			])
		);
		const result = sim.stepPhysical({ maxEvents: 1 });
		expect(result.status).toBe('event-limit');
		expect(result.timePs).toBe(0);
		expect(sim.getNet('A')).toBe('X');
	});

	it('keeps simultaneous transitions distinct', () => {
		const sim = physical(
			document([
				{ id: 'sw', kind: 'switch', inputs: {}, outputs: { out: 'A' } },
				{ id: 'b1', kind: 'buffer', inputs: { a: 'A' }, outputs: { out: 'B1' } },
				{ id: 'b2', kind: 'buffer', inputs: { a: 'A' }, outputs: { out: 'B2' } }
			])
		);
		sim.setState('sw', { value: 1 });
		sim.stepPhysical();
		expect(sim.stepPhysical().timePs).toBe(2000);
		expect(sim.getNet('B1')).toBe(1);
		expect(sim.getNet('B2')).toBe(1);
	});

	const perfIt = process.env.RUN_PERF_SMOKE === '1' ? it : it.skip;
	perfIt('keeps the physical scheduler smoke under its ceiling (RUN_PERF_SMOKE=1)', () => {
		const components: CircuitDocument['components'] = [
			{ id: 'clk', kind: 'clock', inputs: {}, outputs: { out: 'CLK' } }
		];
		for (let index = 0; index < 8; index += 1) {
			components.push({
				id: `inv${index}`,
				kind: 'not',
				inputs: { a: index === 0 ? 'CLK' : `N${index - 1}` },
				outputs: { out: `N${index}` }
			});
		}
		const sim = physical(document(components));
		const started = performance.now();
		let steps = 0;
		while (sim.timePs < 200_000 && steps < 2_000) {
			const result = sim.stepPhysical();
			if (result.status === 'event-limit') break;
			steps += 1;
		}
		expect(sim.timePs).toBeGreaterThanOrEqual(200_000);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});
