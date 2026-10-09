/**
 * Per-kind schematic glyphs for the canvas and palette.
 *
 * Every placeable node kind gets a hand-drawn vector icon in one consistent
 * ink stroke, rendered from a single source of truth: an SVG path string in a
 * 64x40 unit box. The canvas strokes it via Path2D; the palette inlines the
 * same path in an <svg>. No icon library, no emoji, no new dependency —
 * the pinned-worktable world bans all three, and the frontend stays
 * lightweight.
 *
 * Hit-testing, wiring, and layout still use the component rect and pin dots;
 * the glyph is presentation only, drawn over the paper body.
 */

export const GLYPH_VIEWBOX_WIDTH = 64;
export const GLYPH_VIEWBOX_HEIGHT = 40;

/** Body silhouette per kind, unit space 0..64 x 0..40. Stroke-only, ink. */
export const SYMBOL_PATHS: Readonly<Record<string, string>> = Object.freeze({
	// ---- logic gates: distinctive silhouettes, bubbles for negation ----
	and: 'M10 6 H30 A14 14 0 0 1 30 34 H10 Z',
	nand: 'M8 6 H24 A14 14 0 0 1 24 34 H8 Z M38 20 H46 M52 20 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
	or: 'M8 6 Q16 20 8 34 Q28 32 48 20 Q28 8 8 6',
	nor: 'M6 6 Q14 20 6 34 Q24 32 42 20 Q24 8 6 6 M42 20 H46 M52 20 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
	xor: 'M4 6 Q12 20 4 34 M10 6 Q18 20 10 34 Q28 32 48 20 Q28 8 10 6',
	xnor: 'M2 6 Q10 20 2 34 M8 6 Q16 20 8 34 Q26 32 44 20 Q26 8 8 6 M44 20 H46 M52 20 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
	not: 'M10 8 L36 20 L10 32 Z M36 20 H43 M46 20 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0',
	buffer: 'M10 8 L40 20 L10 32 Z',
	// ---- logic I/O ----
	switch:
		'M8 20 H24 M24 20 L42 10 M44 14 V26 M44 20 H56 M24 20 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0',
	probe: 'M8 20 H26 M26 20 L32 13 L38 20 L32 27 Z M38 20 H50',
	led: 'M8 20 H22 M22 12 V28 L36 20 Z M36 12 V28 M36 20 H52 M42 12 L47 6 M47 13 L52 7',
	clock: 'M10 8 H54 V32 H10 Z M18 25 V15 H26 V25 H34 V15 H42 V25',
	// ---- sequential: box + clock wedge; latch has none, SR adds a divider ----
	dFlipFlop: 'M10 6 H54 V34 H10 Z M10 24 L17 27.5 L10 31',
	jkFlipFlop: 'M10 6 H54 V34 H10 Z M10 24 L17 27.5 L10 31 M14 12 H26',
	srFlipFlop: 'M10 6 H54 V34 H10 Z M10 24 L17 27.5 L10 31 M10 19 H54',
	srLatch: 'M10 6 H54 V34 H10 Z M10 19 H54',
	counter: 'M10 6 H54 V34 H10 Z M10 24 L17 27.5 L10 31 M22 13 L30 13 L26 9 L26 17',
	shiftRegister: 'M10 6 H54 V34 H10 Z M10 24 L17 27.5 L10 31 M22 20 H34 L30 16 L30 24',
	// ---- arithmetic and routing ----
	halfAdder: 'M10 6 H54 V34 H10 Z M40 12 H28 L34 20 L28 28 H40',
	fullAdder: 'M10 6 H54 V34 H10 Z M40 12 H28 L34 20 L28 28 H40 M15 26 V32 M12 29 H18',
	mux2: 'M14 6 L46 12 L46 28 L14 34 Z M22 30 L27 24 L32 30',
	mux4: 'M14 6 L46 12 L46 28 L14 34 Z M19 31 L28 21 L37 31',
	decoder2: 'M10 6 H54 V34 H10 Z M16 20 L38 11 M16 20 L38 20 M16 20 L38 29',
	decoder3: 'M10 6 H54 V34 H10 Z M16 20 L38 11 M16 20 L38 20 M16 20 L38 29',
	rom: 'M14 8 H52 V34 H14 Z M18 4 H56 V30 M20 15 H46 M20 21 H46 M20 27 H46',
	ram: 'M10 6 H54 V34 H10 Z M32 6 V34 M10 26 L16 29 L10 32',
	register: 'M10 6 H54 V34 H10 Z M10 24 L17 27.5 L10 31 M24 13 V27 M32 13 V27 M40 13 V27',
	registerFile:
		'M10 6 H54 V34 H10 Z M28 6 V34 M38 6 V34 M10 26 L16 29 L10 32',
	rippleCarryAdder:
		'M10 6 H54 V34 H10 Z M14 15 L22 20 L14 25 M28 15 L36 20 L28 25 M42 15 L50 20 L42 25',
	magnitudeComparator: 'M10 6 H54 V34 H10 Z M22 12 H38 M22 16 H38 M26 22 L38 26 L26 30',
	subcircuit: 'M10 6 H54 V34 H10 Z M18 12 H46 V28 H18 Z',
	// ---- analog sources and passives ----
	vsource:
		'M8 20 H20 M44 20 H56 M32 20 m-12 0 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 M32 12 V18 M29 15 H35 M29 25 H35',
	isource:
		'M8 20 H20 M44 20 H56 M32 20 m-12 0 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 M32 12 V25 M28 21 L32 27 L36 21',
	resistor: 'M8 20 H16 L20 12 L26 28 L32 12 L38 28 L44 12 L48 20 H56',
	capacitor: 'M8 20 H28 M28 10 V30 M32 10 V30 M32 20 H56',
	inductor:
		'M8 20 H16 A4 4 0 0 1 24 20 A4 4 0 0 1 32 20 A4 4 0 0 1 40 20 A4 4 0 0 1 48 20 M48 20 H56',
	potentiometer:
		'M8 20 H16 L20 12 L26 28 L32 12 L38 28 L44 12 L48 20 H56 M32 36 V24 M28 28 L32 24 L36 28',
	diode: 'M8 20 H22 M22 12 V28 L36 20 Z M36 12 V28 M36 20 H56',
	zener: 'M8 20 H22 M22 12 V28 L36 20 Z M32 12 H36 V28 H40 M36 20 H56',
	bjt: 'M8 20 H28 M8 10 L28 16 M28 8 V32 M28 24 L48 31 M42 26 L48 31 L41 30',
	mosfet:
		'M8 20 H26 M26 12 V28 M30 8 V32 M8 10 H30 M30 24 L48 31 M42 26 L48 31 L41 30',
	idealOpamp: 'M14 6 L50 20 L14 34 Z M22 15 H30 M22 25 H30 M26 21 V29',
	opamp: 'M14 6 L50 20 L14 34 Z M22 15 H30 M22 25 H30 M26 21 V29 M37 16 V24',
	comparator: 'M14 6 L44 17 V23 L14 34 Z M22 15 H30 M22 25 H30 M26 21 V29',
	timer555: 'M14 6 H50 V34 H14 Z M26 6 V11 H38 V6 M14 22 H50',
	regulator: 'M14 6 H50 V34 H14 Z M20 18 H34 M30 14 L36 18 L30 22 M24 26 V34',
	ground: 'M32 8 V18 M22 18 H42 M26 24 H38 M30 30 H34',
	// ---- neutral fallback for unknown or future kinds ----
	generic: 'M14 6 H50 V34 H14 Z M22 20 H42'
});

/**
 * Shape-family glyphs keep their proportions however tall the body gets
 * (gate curves, circles, transistor symbols must not stretch). Everything
 * else is box linework that fills the body.
 */
const SHAPE_FAMILY: ReadonlySet<string> = new Set([
	'and',
	'or',
	'not',
	'nand',
	'nor',
	'xor',
	'xnor',
	'buffer',
	'switch',
	'probe',
	'led',
	'clock',
	'vsource',
	'isource',
	'resistor',
	'capacitor',
	'inductor',
	'potentiometer',
	'diode',
	'zener',
	'bjt',
	'mosfet',
	'idealOpamp',
	'opamp',
	'comparator',
	'ground'
]);

/**
 * Resolve any component kind to a glyph key. Parameterized logic kinds
 * (decoder widths, ROM/RAM/Register widths, ripple adders, comparators) share
 * their family's glyph; anything unrecognized falls back to generic.
 */
export function symbolKeyFor(kind: string): string {
	if (Object.hasOwn(SYMBOL_PATHS, kind)) return kind;
	if (kind.startsWith('decoder')) return 'decoder2';
	if (kind.startsWith('registerFile')) return 'registerFile';
	if (kind.startsWith('register')) return 'register';
	if (kind.startsWith('ripple')) return 'rippleCarryAdder';
	if (kind.startsWith('magnitudeComparator')) return 'magnitudeComparator';
	if (kind.startsWith('rom')) return 'rom';
	if (kind.startsWith('ram')) return 'ram';
	return 'generic';
}

/**
 * Stroke the kind glyph inside a screen-space box. Caller sets strokeStyle;
 * line width is compensated so the glyph keeps body-weight strokes at any zoom.
 */
export function drawKindGlyph(
	ctx: CanvasRenderingContext2D,
	kind: string,
	x: number,
	y: number,
	width: number,
	height: number
): void {
	const key = symbolKeyFor(kind);
	const data = SYMBOL_PATHS[key] ?? SYMBOL_PATHS.generic;
	const path = new Path2D(data);
	const scaleX = width / GLYPH_VIEWBOX_WIDTH;
	const scaleY = height / GLYPH_VIEWBOX_HEIGHT;
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();
	if (SHAPE_FAMILY.has(key)) {
		const scale = Math.min(scaleX, scaleY);
		if (scale <= 0) {
			ctx.restore();
			return;
		}
		ctx.translate(x + (width - GLYPH_VIEWBOX_WIDTH * scale) / 2, y + (height - GLYPH_VIEWBOX_HEIGHT * scale) / 2);
		ctx.scale(scale, scale);
		ctx.lineWidth = 1.6 / scale;
	} else {
		if (scaleX <= 0 || scaleY <= 0) {
			ctx.restore();
			return;
		}
		ctx.translate(x, y);
		ctx.scale(scaleX, scaleY);
		ctx.lineWidth = 1.6 / ((scaleX + scaleY) / 2);
	}
	ctx.stroke(path);
	ctx.restore();
}
