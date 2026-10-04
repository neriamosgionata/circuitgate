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
import { dFlipFlop, jkFlipFlop, srFlipFlop, srLatch } from './flipflops';
import { mux2, mux4 } from './mux';
import { decoderKind } from './decoder';
import { fullAdder, halfAdder } from './adders';

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
	decoder3: decoderKind(3)
});
