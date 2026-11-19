/**
 * Canvas palettes for the scope, Bode plot, and waveform viewer.
 *
 * Canvas drawing cannot read CSS custom properties the same way the DOM can,
 * so the ink and rule values are mirrored here from `world.css`. Keep this
 * list in sync with that palette.
 */
export const CHART = {
	plot: '#ffffff',
	plotAlt: '#f7f9fa',
	rule: '#e7ecef',
	ruleStrong: '#b4c0c8',
	ink: '#101820',
	inkSoft: '#46525d',
	inkFaint: '#66737e',
	biro: '#1858c9',
	ochre: '#8f5b00',
	unknownWash: 'rgba(143, 91, 0, 0.14)',
	mono: '"JetBrains Mono", ui-monospace, monospace'
} as const;
