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
import { counterKind, shiftRegisterKind } from './sequential';
import { mux2, mux4 } from './mux';
import { decoderKind } from './decoder';
import { sevenSegDecoderKind, sevenSegDisplay } from './display';
import { fullAdder, halfAdder, magnitudeComparatorKind, rippleCarryAdderKind } from './adders';
import { ramKind, registerFileKind, romKind, ROM_DEFAULT_CONTENTS } from './memory';
import { DEFAULT_ADDRESS_BITS, DEFAULT_WORD_BITS, DEFAULT_WIDTH } from './pins';

export * from './gates';
export * from './flipflops';
export * from './sequential';
export * from './mux';
export * from './decoder';
export * from './display';
export * from './adders';
export * from './memory';

// Leaf primitives with fixed pinouts. Width- and content-parameterized kinds
// (decoders above 3 bits, ripple adders, comparators, registers, ROM/RAM, and
// register files) are created with their factories and registered by the
// caller alongside this object.
// Parameterized defaults live in pins.ts and memory.ts; the static
// entries below only let static kind filters (palette, inspector) pass while
// per-component resolution in engine/kinds.ts derives the configured width
// at use time.
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
	sevenSegDecoder: sevenSegDecoderKind,
	sevenSegDisplay,
	rippleCarryAdder: rippleCarryAdderKind(DEFAULT_WIDTH),
	magnitudeComparator: magnitudeComparatorKind(DEFAULT_WIDTH),
	register: registerKind(DEFAULT_WIDTH),
	counter: counterKind(DEFAULT_WIDTH),
	shiftRegister: shiftRegisterKind(DEFAULT_WIDTH),
	registerFile: registerFileKind({ addressBits: DEFAULT_ADDRESS_BITS, wordBits: DEFAULT_WORD_BITS }),
	ram: ramKind({ addressBits: DEFAULT_ADDRESS_BITS, wordBits: DEFAULT_WORD_BITS }),
	rom: romKind({ contents: ROM_DEFAULT_CONTENTS, wordBits: DEFAULT_WORD_BITS })
});
