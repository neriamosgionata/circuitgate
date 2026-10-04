import { describe, expect, it } from 'vitest';
import type { CircuitDocument } from '../../model/circuit';
import type { ComponentKind, ComponentKinds } from '../compile';
import { Simulator } from '../evaluate';

const inputKind: ComponentKind = {
	inputs: [],
	outputs: ['out'],
	evaluate: (_inputs, state) => ({ outputs: [(state as { value: 0 | 1 }).value] })
};

const norKind: ComponentKind = {
	inputs: ['a', 'b'],
	outputs: ['out'],
	evaluate: ([a, b]) => {
		if (a === 1 || b === 1) return { outputs: [0] };
		if (a === 0 && b === 0) return { outputs: [1] };
		return { outputs: ['X'] };
	}
};

const kinds: ComponentKinds = { input: inputKind, nor: norKind };

const srLatch: CircuitDocument = {
	schemaVersion: 1,
	components: [
		{ id: 's', kind: 'input', inputs: {}, outputs: { out: 'S' } },
		{ id: 'r', kind: 'input', inputs: {}, outputs: { out: 'R' } },
		{ id: 'top', kind: 'nor', inputs: { a: 'R', b: 'QN' }, outputs: { out: 'Q' } },
		{ id: 'bottom', kind: 'nor', inputs: { a: 'S', b: 'Q' }, outputs: { out: 'QN' } }
	]
};

function fresh(): Simulator {
	const sim = new Simulator(srLatch, kinds);
	sim.setState('s', { value: 0 });
	sim.setState('r', { value: 0 });
	return sim;
}

describe('feedback determinism (AE2)', () => {
	it('settles to a stable state from each input sequence, identical on every run', () => {
		for (let run = 0; run < 5; run++) {
			const sim = fresh();

			sim.setState('s', { value: 1 });
			expect(sim.settle().status).toBe('stable');
			expect(sim.getNet('Q')).toBe(1);
			expect(sim.getNet('QN')).toBe(0);

			sim.setState('s', { value: 0 });
			expect(sim.settle().status).toBe('stable');
			expect(sim.getNet('Q')).toBe(1);

			sim.setState('r', { value: 1 });
			expect(sim.settle().status).toBe('stable');
			expect(sim.getNet('Q')).toBe(0);
			expect(sim.getNet('QN')).toBe(1);

			sim.setState('r', { value: 0 });
			expect(sim.settle().status).toBe('stable');
			expect(sim.getNet('Q')).toBe(0);
		}
	});

	it('holding both inputs high then releasing produces the same defined outcome every run', () => {
		const outcomes: string[] = [];
		for (let run = 0; run < 5; run++) {
			const sim = fresh();

			sim.setState('s', { value: 1 });
			sim.setState('r', { value: 1 });
			sim.settle();
			expect(sim.getNet('Q')).toBe(0);
			expect(sim.getNet('QN')).toBe(0);

			sim.setState('s', { value: 0 });
			sim.setState('r', { value: 0 });
			const result = sim.settle({ maxDeltaCycles: 200 });
			outcomes.push(
				JSON.stringify({
					status: result.status,
					nets: [...result.oscillatingNets].sort((a, b) => a - b),
					q: sim.getNet('Q'),
					qn: sim.getNet('QN')
				})
			);
		}
		expect(new Set(outcomes).size).toBe(1);
	});
});
