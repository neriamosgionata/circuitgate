import { expect, test } from '@playwright/test';

import { expectByte, expectProbe, openFixture, pulseClock, setSwitch } from './logic';

// AE5: a small CPU fixture built from primitive kinds plus an increment4
// subcircuit. The hardwired program is:
//   PC=00: A <- A + 1        (op = PC0 = 0)
//   PC=01: mem[PC1=0] <- A   (op = PC0 = 1, address = PC1)
//   PC=10: A <- A + 1
//   PC=11: mem[PC1=1] <- A
// Each rising CLK edge executes the instruction selected by the pre-edge PC.
// After four pulses the final state is A=2 (0b0010), mem[0]=1, mem[1]=2.
test.describe('AE5: CPU-scale correctness', () => {
	test('the CPU executes its program to the expected register and memory state', async ({
		page
	}) => {
		await openFixture(page, 'cpu-project.json', { emailPrefix: 'cpu', projectName: 'cpu-fixture' });
		await expectProbe(page, 'A0', '0');
		await setSwitch(page, 'SEL', 0);
		await expectByte(page, 'RD', 0, 4);
		await expectByte(page, 'A', 0, 4);

		await pulseClock(page);
		await expectByte(page, 'A', 1, 4);
		await expectByte(page, 'RD', 0, 4);

		await pulseClock(page);
		await expectByte(page, 'A', 1, 4);
		await expectByte(page, 'RD', 1, 4);

		await pulseClock(page);
		await expectByte(page, 'A', 2, 4);

		await pulseClock(page);
		await expectByte(page, 'A', 2, 4);
		await expectByte(page, 'RD', 1, 4);

		await setSwitch(page, 'SEL', 1);
		await expectByte(page, 'RD', 2, 4);
	});
});
