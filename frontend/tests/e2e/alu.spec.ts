import { expect, test } from '@playwright/test';

import { expectByte, expectProbe, openFixture, readProbe, setByte, setSwitch } from './logic';

// AE1: the ALU fixture is an 8-bit ALU built from primitive gates and two
// nested subcircuits (fullAdder1 inside adder8). Result bits R0..R7 are the
// least-significant-first output; CARRY is the adder carry-out. Select lines:
// OP1 OP0 = 00 ADD, 01 AND, 10 OR, 11 XOR.
//
// Expected vectors (documented here so the fixture is checked independently):
//   A=0x5A B=0x3C: ADD=0x96 carry=0, AND=0x18, OR=0x7E, XOR=0x66
//   A=0xFF B=0x01: ADD=0x00 carry=1, AND=0x01, OR=0xFF, XOR=0xFE
//   A=0xAA B=0x55: ADD=0xFF carry=0, AND=0x00, OR=0xFF, XOR=0xFF
const VECTORS = [
	{ a: 0x5a, b: 0x3c, add: 0x96, carry: '0', and: 0x18, or: 0x7e, xor: 0x66 },
	{ a: 0xff, b: 0x01, add: 0x00, carry: '1', and: 0x01, or: 0xff, xor: 0xfe },
	{ a: 0xaa, b: 0x55, add: 0xff, carry: '0', and: 0x00, or: 0xff, xor: 0xff }
] as const;

test.describe('AE1: 8-bit ALU from gates and subcircuits', () => {
	test('every operation produces the expected outputs', async ({ page }) => {
		await openFixture(page, 'alu-project.json', { emailPrefix: 'alu', projectName: 'alu-fixture' });
		await expect(page.getByTestId('component-count')).toHaveText('65 components');
		await expectProbe(page, 'R0', '0');

		for (const vector of VECTORS) {
			await setByte(page, 'A', vector.a);
			await setByte(page, 'B', vector.b);

			await setSwitch(page, 'OP0', 0);
			await setSwitch(page, 'OP1', 0);
			await expectByte(page, 'R', vector.add);
			await expectProbe(page, 'CARRY', vector.carry);

			await setSwitch(page, 'OP0', 1);
			await expectByte(page, 'R', vector.and);
			await expectProbe(page, 'CARRY', '0');

			await setSwitch(page, 'OP0', 0);
			await setSwitch(page, 'OP1', 1);
			await expectByte(page, 'R', vector.or);
			await expectProbe(page, 'CARRY', '0');

			await setSwitch(page, 'OP0', 1);
			await expectByte(page, 'R', vector.xor);
			await expectProbe(page, 'CARRY', '0');
		}

		// Cross-check one result through the visible probe text directly.
		await setSwitch(page, 'OP0', 0);
		await setSwitch(page, 'OP1', 0);
		await setByte(page, 'A', 0xff);
		await setByte(page, 'B', 0x01);
		await expectProbe(page, 'CARRY', '1');
		expect(await readProbe(page, 'R0')).toBe('0');
	});
});
