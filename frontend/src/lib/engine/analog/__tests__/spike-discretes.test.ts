import { describe, expect, it } from 'vitest';

import { withinRange } from '../tolerance';
import { findVariable, realValues, runDeck } from './harness';

import d1n5819 from '../models/assets/d1n5819.cir?raw';
import ld1117v33 from '../models/assets/ld1117v33.cir?raw';
import q2n3906 from '../models/assets/q2n3906.cir?raw';

describe('U4 discrete breadth: curated cards simulate to datasheet-typical ranges', () => {
	it('Schottky clamp forward drop is low (0.2-0.5 V)', async () => {
		const deck = `${d1n5819}
* Schottky clamp at ~4.5 mA
V1 1 0 DC 5
R1 1 2 1k
D1 2 0 d1n5819
.op
.end
`;
		const { plot } = await runDeck(deck);
		const forwardDrop = realValues(findVariable(plot, 'v(2)'))[0];
		const current = -realValues(findVariable(plot, 'i(v1)'))[0];
		expect(current).toBeGreaterThan(1e-3);
		expect(withinRange(forwardDrop, 0.2, 0.5)).toBe(true);
	});

	it('PNP bias emitter-base drop and collector current are typical', async () => {
		const deck = `${q2n3906}
* PNP common-emitter bias, active region
VCC 4 0 DC 12
RE 4 3 1k
R1 4 2 10k
R2 2 0 47k
RC 1 0 2.2k
Q1 1 2 3 q2n3906
.op
.end
`;
		const { plot } = await runDeck(deck);
		const emitterVoltage = realValues(findVariable(plot, 'v(3)'))[0];
		const baseVoltage = realValues(findVariable(plot, 'v(2)'))[0];
		const collectorVoltage = realValues(findVariable(plot, 'v(1)'))[0];
		const emitterBaseDrop = emitterVoltage - baseVoltage;
		const collectorCurrent = collectorVoltage / 2200;
		expect(withinRange(emitterBaseDrop, 0.55, 0.8)).toBe(true);
		expect(withinRange(collectorCurrent, 0.8e-3, 2e-3)).toBe(true);
		expect(withinRange(collectorVoltage, 1.5, 5)).toBe(true);
	});

	it('3.3 V regulator holds output with a 9 V input', async () => {
		const deck = `${ld1117v33}
* 3V3 LDO with 1k load
V1 1 0 DC 9
X1 1 2 0 ld1117v33
RLOAD 2 0 1k
.op
.end
`;
		const { plot } = await runDeck(deck);
		const output = realValues(findVariable(plot, 'v(2)'))[0];
		expect(withinRange(output, 3.234, 3.366)).toBe(true);
	});
});
