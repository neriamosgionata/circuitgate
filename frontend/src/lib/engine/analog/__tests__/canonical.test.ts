import { describe, expect, it } from 'vitest';

import type {
	AnalogAnalysis,
	AnalogModel,
	CircuitDocument,
	Component
} from '../../../model/circuit';
import { emitNetlist } from '../netlist';
import { validateStoredModels } from '../parser';
import { ANALOG_TOLERANCES, withinRelative } from '../tolerance';
import { findVariable, realValues, runDeck } from './harness';

/**
 * U8 canonical re-emission and hostile-input proof (KTD6). Every accepted
 * model is parsed and re-serialized token by token; raw imported text, called
 * out constructs never reach the emitted deck, and the worker-side
 * re-validation catches hostile stored documents the main-thread emission
 * never references.
 */

const VENDOR_OPAMP = `* Vendor-style op-amp macromodel
.SUBCKT vendoropamp inp inn vcc vee out
+ params: gain=100000
rin\tinp   inn 1meg ; input resistance
eout out 0 inp inn {gain}
.ENDS VENDOROPAMP`;

function component(
	id: string,
	kind: string,
	inputs: Record<string, string>,
	outputs: Record<string, string>,
	params?: Record<string, unknown>
): Component {
	return params === undefined
		? { id, kind, inputs, outputs }
		: { id, kind, inputs, outputs, params };
}

function document(components: Component[], models: AnalogModel[] = []): CircuitDocument {
	return { schemaVersion: 1, domain: 'analog', components, models };
}

function imported(name: string, source: string): AnalogModel {
	return { name, formatVersion: 1, source };
}

const OP: AnalogAnalysis = { id: 'op1', kind: 'op', params: {} };

function opampDocument(models: AnalogModel[]): CircuitDocument {
	return document(
		[
			component('g1', 'ground', { p1: '0' }, {}),
			component('vcc', 'vsource', {}, { p2: 'vcc' }, { waveform: 'dc', voltage: 12 }),
			component('vee', 'vsource', {}, { p2: 'vee' }, { waveform: 'dc', voltage: -12 }),
			component('vin', 'vsource', {}, { p2: 'inp' }, { waveform: 'dc', voltage: 1 }),
			component(
				'x1',
				'opamp',
				{ inp: 'inp', inn: 'out', vcc: 'vcc', vee: 'vee' },
				{ out: 'out' },
				{ model: 'vendoropamp' }
			),
			component('rl', 'resistor', { p1: 'out' }, { p2: '0' }, { resistance: 10000 })
		],
		models
	);
}

describe('canonical re-emission (U8/KTD6)', () => {
	it('emits only parsed structure for a vendor-style subckt with continuations and comments', () => {
		const result = emitNetlist(opampDocument([imported('vendoropamp', VENDOR_OPAMP)]), OP);
		expect(result.problems).toEqual([]);

		const modelSection = result.deck;
		expect(modelSection).toContain('.subckt vendoropamp inp inn vcc vee out');
		// numparam is excluded from the engine, so the header loses `params:`
		// and the resolved default is folded into the body.
		expect(modelSection).not.toContain('params:');
		expect(modelSection).toContain('rin inp inn 1000000');
		expect(modelSection).toContain('eout out 0 inp inn 100000');
		expect(modelSection).toContain('X1 inp out vcc vee out vendoropamp');
		expect(modelSection).toContain('.ends vendoropamp');

		// No raw-text artifact survives re-emission: comments, continuation
		// markers, inline comments, tabs, doubled spaces, or braces.
		expect(modelSection).not.toContain('Vendor-style');
		expect(modelSection).not.toContain('input resistance');
		expect(modelSection).not.toContain('+ params');
		expect(modelSection).not.toContain('\t');
		expect(modelSection).not.toContain(';');
		expect(modelSection).not.toMatch(/ {2,}\S/);
		expect(modelSection).not.toContain('{');
		expect(modelSection).not.toContain('}');
		expect(modelSection).not.toContain('1meg');
	});

	it('normalizes formatting differences to one canonical form', () => {
		const messy = `.MODEL mydiode   d(   is = 1e-14
+   n=1.2 )   ; trailing comment`;
		const tidy = '.model mydiode d(is=1e-14 n=1.2)';
		const first = emitNetlist(
			document(
				[component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'mydiode' })],
				[imported('mydiode', messy)]
			),
			OP
		);
		const second = emitNetlist(
			document(
				[component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'mydiode' })],
				[imported('mydiode', tidy)]
			),
			OP
		);
		expect(first.problems).toEqual([]);
		expect(first.deck).toContain('.model mydiode d(is=1e-14 n=1.2)');
		expect(first.deck).not.toContain('trailing comment');
		expect(first.deck).toBe(second.deck);
	});

	it('never emits directive-shaped raw text from a comment or inline comment', () => {
		const source = `* .include "/tmp/evil.lib"
.model safe d(is=1e-14) ; .control
* .end`;
		const result = emitNetlist(
			document(
				[component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'safe' })],
				[imported('safe', source)]
			),
			OP
		);
		expect(result.problems).toEqual([]);
		expect(result.deck).toContain('.model safe d(is=1e-14)');
		expect(result.deck).not.toContain('.include');
		expect(result.deck).not.toContain('.control');
		expect(result.deck).not.toContain('evil');
	});

	it('rejects a stored model with embedded directives and emits no instances or text', () => {
		const result = emitNetlist(
			document(
				[component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: 'evil' })],
				[imported('evil', '.model evil d()\n.control\nrun\n.endc')]
			),
			OP
		);
		expect(result.problems.map((problem) => problem.code)).toContain('model-unsupported');
		expect(result.deck).not.toContain('.control');
		expect(result.deck).not.toContain('.endc');
		expect(result.deck).not.toContain('evil');
		expect(result.deck).not.toContain('D1');
	});

	it('rejects a markup model name and never splices it into the deck', () => {
		const markup = '<img src=x onerror=alert(1)>';
		const result = emitNetlist(
			document(
				[component('d1', 'diode', { p1: 'a' }, { p2: 'b' }, { model: markup })],
				[imported(markup, '.model img d(is=1e-14)')]
			),
			OP
		);
		expect(result.problems.map((problem) => problem.code)).toContain('model-unsupported');
		expect(result.deck).not.toContain('<img');
		expect(result.deck).not.toContain('onerror');
		expect(result.deck).not.toContain('D1');
	});
});

describe('worker-side per-run re-validation (U8/KTD6)', () => {
	it('accepts every stored model the import path accepts', () => {
		expect(
			validateStoredModels([
				{ name: 'vendoropamp', source: VENDOR_OPAMP },
				{ name: 'mydiode', source: '.model mydiode d(is=1e-14)' }
			])
		).toEqual({ ok: true });
	});

	it('catches a hostile stored model the main-thread emission never references', () => {
		const hostile = imported('evil', '.model evil d()\n.control\nrun\n.endc');
		const doc = document(
			[
				component('g1', 'ground', { p1: '0' }, {}),
				component('v1', 'vsource', {}, { p2: 'a' }, { waveform: 'dc', voltage: 5 }),
				component('r1', 'resistor', { p1: 'a' }, { p2: '0' }, { resistance: 1000 })
			],
			[hostile]
		);
		// The hostile entry is unreferenced, so emission alone produces a clean
		// deck: only the worker's repeated parse can catch the document.
		const emission = emitNetlist(doc, OP);
		expect(emission.problems).toEqual([]);
		expect(emission.deck).not.toContain('.control');

		const validation = validateStoredModels(doc.models ?? []);
		expect(validation.ok).toBe(false);
		if (!validation.ok) {
			expect(validation.message).toContain('evil');
			expect(validation.message).toContain('.control');
		}
	});

	it('rejects malformed stored entries and non-string sources without throwing', () => {
		const missingSource = validateStoredModels([
			{ name: 'broken' } as unknown as { name: string; source: string }
		]);
		expect(missingSource.ok).toBe(false);
	});
});

describe('imported model instantiation end to end (AE5)', () => {
	it('a vendor-style subckt op-amp parses, instantiates, and simulates', async () => {
		const result = emitNetlist(opampDocument([imported('vendoropamp', VENDOR_OPAMP)]), OP);
		expect(result.problems).toEqual([]);

		const { plot, diagnostics, exitCode } = await runDeck(result.deck);
		expect(exitCode).toBe(0);
		expect(diagnostics).toEqual([]);

		const output = realValues(findVariable(plot, 'v(out)'))[0];
		expect(withinRelative(output, 1.0, ANALOG_TOLERANCES.opLinear)).toBe(true);
	});
});
