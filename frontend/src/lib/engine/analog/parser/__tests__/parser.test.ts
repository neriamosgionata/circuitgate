import { describe, expect, it } from 'vitest';

import { ModelCaps, parseModelSource, validateStoredModels } from '../index';

const VENDOR_OPAMP = `* Vendor-style op-amp macromodel
.SUBCKT vendoropamp inp inn out
+ params: gain=100000
rin inp inn 1meg ; input resistance
eout out 0 inp inn {gain}
.ENDS VENDOROPAMP`;

function parsed(name: string, source: string) {
	const result = parseModelSource(name, source);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.message);
	return result.model;
}

describe('model parser: accepted subset', () => {
	it('parses a vendor-style subckt with continuations, comments, case-insensitive directives and SI suffixes', () => {
		const model = parsed('vendoropamp', VENDOR_OPAMP);
		expect(model.name).toBe('vendoropamp');
		expect(model.root.kind).toBe('subckt');
		if (model.root.kind !== 'subckt') return;
		expect(model.root.terminals).toEqual(['inp', 'inn', 'out']);
		expect(model.root.parameters).toEqual({ gain: 100000 });
		expect(model.canonical[0]).toBe('.subckt vendoropamp inp inn out');
		expect(model.canonical.join('\n')).not.toContain('params:');
		expect(model.canonical).toContain('rin inp inn 1000000');
		expect(model.canonical).toContain('eout out 0 inp inn 100000');
		expect(model.canonical[model.canonical.length - 1]).toBe('.ends vendoropamp');
		expect(model.canonical.join('\n')).not.toContain('*');
		expect(model.nodes).toContain('inp');
		expect(model.depth).toBe(0);
		expect(model.expandedInstances).toBe(0);
	});

	it('evaluates .param definitions and brace expressions without eval', () => {
		const source = `.param rbase = 1k
.param rload = {rbase * 2}
.model mydiode d(is={1e-3 / 2} n={max(1, 2)} rs={sqrt(4)})`;
		const model = parsed('mydiode', source);
		expect(model.canonical).toEqual([
			'.model mydiode d(is=0.0005 n=2 rs=2)'
		]);
		expect(model.root.kind).toBe('model');
	});

	it('accepts whitelisted functions and rejects unknown ones', () => {
		expect(parseModelSource('d1', '.model d1 d(is={abs(-1e-3) + min(1, 2)})').ok).toBe(true);
		const unknownFunction = parseModelSource('d1', '.model d1 d(is={evil(1)})');
		expect(unknownFunction.ok).toBe(false);
		if (!unknownFunction.ok) expect(unknownFunction.message).toContain('unknown function');
		const unknownParameter = parseModelSource('d1', '.model d1 d(is={missing_param})');
		expect(unknownParameter.ok).toBe(false);
		if (!unknownParameter.ok) expect(unknownParameter.message).toContain('unknown parameter');
		const divideByZero = parseModelSource('d1', '.model d1 d(is={1 / 0})');
		expect(divideByZero.ok).toBe(false);
		if (!divideByZero.ok) expect(divideByZero.message.toLowerCase()).toContain('zero');
	});

	it('drops .param lines and substitutes brace values inside element lines', () => {
		const model = parsed(
			'rcfilter',
			`.param rval = 4.7k
.param cval = {1u / 2}
.subckt rcfilter in out
R1 in out {rval}
C1 out 0 {cval}
.ends rcfilter`
		);
		expect(model.canonical).toEqual([
			'.subckt rcfilter in out',
			'R1 in out 4700',
			'C1 out 0 5e-7',
			'.ends rcfilter'
		]);
	});

	it('parses a plain device model card and canonicalizes its numbers', () => {
		const model = parsed('mydiode', '* comment\n.model mydiode d(is=1e-14 n=1.2)');
		expect(model.canonical).toEqual(['.model mydiode d(is=1e-14 n=1.2)']);
		expect(model.root.kind).toBe('model');
	});

	it('accepts helper subcircuits and reports local depth and expansion counts', () => {
		const source = `.subckt outer in out
X1 in mid inner
X2 mid out inner
.ends outer
.subckt inner a b
R1 a b 1k
.ends inner`;
		const model = parsed('outer', source);
		expect(model.definitions).toHaveLength(2);
		expect(model.canonical).toEqual([
			'.subckt outer in out',
			'X1 in mid inner',
			'X2 mid out inner',
			'.ends outer',
			'.subckt inner a b',
			'R1 a b 1000',
			'.ends inner'
		]);
		expect(model.expandedInstances).toBe(2);
		expect(model.depth).toBe(1);
	});

	it('keeps behavioral element expressions intact while evaluating braces', () => {
		const source = `.param gain = 2
.subckt behave in out
B1 out 0 V = (v(in) > 0.5) ? (v(in) * {gain}) : 0
.ends behave`;
		const model = parsed('behave', source);
		expect(model.canonical).toContain('B1 out 0 V = (v(in) > 0.5) ? (v(in) * 2) : 0');
	});
});

describe('model parser: rejection paths', () => {
	it('rejects .include and .lib with an explicit unsupported diagnostic', () => {
		for (const source of [
			'.include "vendor.lib"',
			'.inc vendor.lib',
			'.lib vendor.lib',
			'.LIB "vendor.lib"'
		]) {
			const result = parseModelSource('nothing', source);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.message).toContain('not supported');
				expect(result.message).not.toContain('unknown directive');
			}
		}
	});

	it('rejects split-token and continuation-line include variants', () => {
		for (const source of [
			'.inc\n+lude "vendor.lib"',
			'.li\n+b vendor.lib',
			'.include\n+ "vendor.lib"'
		]) {
			const result = parseModelSource('nothing', source);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.message).toContain('not supported');
		}
	});

	it('rejects subcircuit instance parameter overrides the engine cannot evaluate', () => {
		const result = parseModelSource(
			'outer',
			'.subckt outer a b\nX1 a b inner g=2\n.ends outer\n.subckt inner x y\nR1 x y 1k\n.ends inner'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('parameter overrides');
	});

	it('rejects a newline plus directive inside model text', () => {
		const source = `.subckt evil a b
X1 a b sub
.control
run
.endc
.ends evil`;
		const result = parseModelSource('evil', source);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('.control');
	});

	it('rejects a directive token spliced mid-line', () => {
		const result = parseModelSource(
			'evil',
			'.subckt evil a b\nX1 a b sub .control\n.ends evil'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('.control');
	});

	it('rejects unsupported characters instead of neutralizing them', () => {
		const result = parseModelSource('evil', '.subckt evil a b\nX1 a b su"b\n.ends evil');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message.toLowerCase()).toContain('character');
	});

	it('rejects self-recursive and mutually recursive definitions', () => {
		const self = parseModelSource('a', '.subckt a x y\nX1 x y a\n.ends a');
		expect(self.ok).toBe(false);
		if (!self.ok) expect(self.message.toLowerCase()).toContain('cycle');

		const mutual = parseModelSource(
			'a',
			'.subckt a x y\nX1 x y b\n.ends a\n.subckt b x y\nX1 x y a\n.ends b'
		);
		expect(mutual.ok).toBe(false);
		if (!mutual.ok) expect(mutual.message.toLowerCase()).toContain('cycle');
	});

	it('rejects definitions nested beyond the depth cap', () => {
		const depth = ModelCaps.maxSubcircuitDepth + 2;
		const parts: string[] = [];
		for (let index = 0; index < depth; index += 1) {
			parts.push(`.subckt s${index} in out\nX1 in out s${index + 1}\n.ends s${index}`);
		}
		parts.push(`.subckt s${depth} in out\nR1 in out 1k\n.ends s${depth}`);
		const result = parseModelSource('s0', parts.join('\n'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('depth');
	});

	it('rejects an instantiation explosion just over the expanded-instance cap', () => {
		const fan = (name: string, target: string): string => {
			const lines = [`.subckt ${name} in out`];
			for (let index = 0; index < 10; index += 1) lines.push(`X${index} in out ${target}`);
			lines.push(`.ends ${name}`);
			return lines.join('\n');
		};
		const source = [
			fan('a', 'b'),
			fan('b', 'c'),
			fan('c', 'd'),
			'.subckt d in out\nR1 in out 1k\n.ends d'
		].join('\n');
		const result = parseModelSource('a', source);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('expanded instance');
	});

	it('accepts an instantiation fan-out under the expanded-instance cap', () => {
		const fan = (name: string, target: string): string => {
			const lines = [`.subckt ${name} in out`];
			for (let index = 0; index < 9; index += 1) lines.push(`X${index} in out ${target}`);
			lines.push(`.ends ${name}`);
			return lines.join('\n');
		};
		const source = [
			fan('a', 'b'),
			fan('b', 'c'),
			fan('c', 'd'),
			'.subckt d in out\nR1 in out 1k\n.ends d'
		].join('\n');
		const result = parseModelSource('a', source);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.model.expandedInstances).toBe(9 + 81 + 729);
			expect(result.model.depth).toBe(3);
		}
	});

	it('rejects oversized text before scanning it', () => {
		const result = parseModelSource('big', 'x'.repeat(ModelCaps.maxTextLength + 1));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain(String(ModelCaps.maxTextLength));
	});

	it('rejects a pathological single line without stalling', () => {
		const started = performance.now();
		const result = parseModelSource('long', `.model long d(${'a'.repeat(5000)}=1)`);
		const elapsed = performance.now() - started;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain(String(ModelCaps.maxLineLength));
		expect(elapsed).toBeLessThan(1000);
	});

	it('rejects over-long tokens and identifiers', () => {
		const longToken = parseModelSource('d1', `.model d1 d(${'a'.repeat(200)}=1)`);
		expect(longToken.ok).toBe(false);
		if (!longToken.ok) expect(longToken.message).toContain(String(ModelCaps.maxTokenLength));

		const longName = 'a'.repeat(ModelCaps.maxIdentifierLength + 1);
		const result = parseModelSource(longName, '.model a d()');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('name');
	});

	it("rejects a model name with markup characters and a mismatched declaration", () => {
		const markup = parseModelSource('<img src=x onerror=alert(1)>', '.model good d()');
		expect(markup.ok).toBe(false);
		if (!markup.ok) expect(markup.message).toContain('unsupported characters');

		const mismatch = parseModelSource('wanted', '.model other d()');
		expect(mismatch.ok).toBe(false);
		if (!mismatch.ok) expect(mismatch.message).toContain('wanted');
	});

	it('rejects duplicate definition names and stray element lines', () => {
		const duplicate = parseModelSource(
			'a',
			'.subckt a x y\nR1 x y 1k\n.ends a\n.subckt a x y\nR1 x y 1k\n.ends a'
		);
		expect(duplicate.ok).toBe(false);
		if (!duplicate.ok) expect(duplicate.message.toLowerCase()).toContain('duplicate');

		const stray = parseModelSource('a', 'R1 x y 1k');
		expect(stray.ok).toBe(false);
		if (!stray.ok) expect(stray.message).toContain('expected');
	});

	it('rejects parameter-count and node-count cap violations', () => {
		const params = ['.model base d()'];
		for (let index = 0; index <= ModelCaps.maxParameters; index += 1) {
			params.push(`.param p${index}=1`);
		}
		const paramResult = parseModelSource('base', params.join('\n'));
		expect(paramResult.ok).toBe(false);
		if (!paramResult.ok) expect(paramResult.message).toContain('parameter');

		const body = ['.subckt wide in out'];
		for (let index = 0; index <= ModelCaps.maxNodes; index += 1) {
			body.push(`R${index} n${index} n${index + 1} 1k`);
		}
		body.push('.ends wide');
		const nodeResult = parseModelSource('wide', body.join('\n'));
		expect(nodeResult.ok).toBe(false);
		if (!nodeResult.ok) expect(nodeResult.message).toContain('node');
	});
});

describe('stored model re-validation', () => {
	it('accepts valid stored models and rejects hostile stored sources', () => {
		const ok = validateStoredModels([
			{ name: 'vendoropamp', source: VENDOR_OPAMP },
			{ name: 'mydiode', source: '.model mydiode d(is=1e-14)' }
		]);
		expect(ok.ok).toBe(true);

		const hostile = validateStoredModels([
			{ name: 'evil', source: '.model evil d()\n.control\nrun\n.endc' }
		]);
		expect(hostile.ok).toBe(false);
		if (!hostile.ok) expect(hostile.message).toContain('evil');

		const include = validateStoredModels([
			{ name: 'evil', source: '.include "/tmp/evil.lib"' }
		]);
		expect(include.ok).toBe(false);
		if (!include.ok) expect(include.message).toContain('not supported');
	});
});
