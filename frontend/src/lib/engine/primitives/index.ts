import type { ComponentKinds } from '../compile';
import {
	andKind,
	bufferKind,
	clockKind,
	ledKind,
	nandKind,
	norKind,
	notKind,
	orKind,
	probeKind,
	switchKind,
	xnorKind,
	xorKind
} from './gates';
import { dFlipFlop, jkFlipFlop, registerKind, srFlipFlop, srLatch } from './flipflops';
import { mux2, mux4 } from './mux';
import { decoderKind } from './decoder';
import { fullAdder, halfAdder, magnitudeComparatorKind, rippleCarryAdderKind } from './adders';
import { ramKind, registerFileKind, romKind } from './memory';

export * from './gates';
export * from './flipflops';
export * from './mux';
export * from './decoder';
export * from './adders';
export * from './memory';

// Leaf primitives with fixed pinouts. Width- and content-parameterized kinds
// (decoders above 3 bits, ripple adders, comparators, registers, ROM/RAM, and
// register files) are created with their factories and registered by the
// caller alongside this object.
// Parameterized defaults per KTD5: width families default to 8, memories to
// addressBits 4 / wordBits 8, ROM to sixteen zeros. Registered here so static
// kind filters (palette, inspector) pass while per-component resolution in
// engine/kinds.ts derives the configured width at use time.
const defaultRomContents: readonly number[] = Object.freeze(new Array(16).fill(0));

export const primitiveKinds: ComponentKinds = Object.freeze({
	and: andKind,
	or: orKind,
	not: notKind,
	nand: nandKind,
	nor: norKind,
	xor: xorKind,
	xnor: xnorKind,
	buffer: bufferKind,
	switch: switchKind,
	probe: probeKind,
	led: ledKind,
	clock: clockKind,
	dFlipFlop,
	jkFlipFlop,
	srFlipFlop,
	srLatch,
	mux2,
	mux4,
	halfAdder,
	fullAdder,
	decoder2: decoderKind(2),
	decoder3: decoderKind(3),
	rippleCarryAdder: rippleCarryAdderKind(8),
	magnitudeComparator: magnitudeComparatorKind(8),
	register: registerKind(8),
	registerFile: registerFileKind({ addressBits: 4, wordBits: 8 }),
	ram: ramKind({ addressBits: 4, wordBits: 8 }),
	rom: romKind({ contents: defaultRomContents, wordBits: 8 })
});
