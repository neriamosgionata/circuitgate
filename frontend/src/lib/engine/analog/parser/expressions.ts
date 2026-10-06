import { parseSI } from '../si';
import type { Token } from './tokenizer';

/**
 * Whitelisted brace-expression evaluator (U8, KTD6). The parser never calls
 * `eval` or the Function constructor: only the operators and named functions
 * below can turn token streams into numbers, and every result must be finite.
 */

export type ExpressionResult =
	| { ok: true; value: number; next: number }
	| { ok: false; message: string };

interface FunctionSpec {
	minArgs: number;
	maxArgs: number;
	fn: (args: number[]) => number;
}

const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = Object.freeze({
	abs: { minArgs: 1, maxArgs: 1, fn: (args) => Math.abs(args[0]) },
	sqrt: { minArgs: 1, maxArgs: 1, fn: (args) => Math.sqrt(args[0]) },
	exp: { minArgs: 1, maxArgs: 1, fn: (args) => Math.exp(args[0]) },
	ln: { minArgs: 1, maxArgs: 1, fn: (args) => Math.log(args[0]) },
	log10: { minArgs: 1, maxArgs: 1, fn: (args) => Math.log10(args[0]) },
	sin: { minArgs: 1, maxArgs: 1, fn: (args) => Math.sin(args[0]) },
	cos: { minArgs: 1, maxArgs: 1, fn: (args) => Math.cos(args[0]) },
	tan: { minArgs: 1, maxArgs: 1, fn: (args) => Math.tan(args[0]) },
	asin: { minArgs: 1, maxArgs: 1, fn: (args) => Math.asin(args[0]) },
	acos: { minArgs: 1, maxArgs: 1, fn: (args) => Math.acos(args[0]) },
	atan: { minArgs: 1, maxArgs: 1, fn: (args) => Math.atan(args[0]) },
	atan2: { minArgs: 2, maxArgs: 2, fn: (args) => Math.atan2(args[0], args[1]) },
	min: { minArgs: 2, maxArgs: 8, fn: (args) => Math.min(...args) },
	max: { minArgs: 2, maxArgs: 8, fn: (args) => Math.max(...args) },
	pow: { minArgs: 2, maxArgs: 2, fn: (args) => Math.pow(args[0], args[1]) },
	pwr: { minArgs: 2, maxArgs: 2, fn: (args) => Math.pow(args[0], args[1]) },
	floor: { minArgs: 1, maxArgs: 1, fn: (args) => Math.floor(args[0]) },
	ceil: { minArgs: 1, maxArgs: 1, fn: (args) => Math.ceil(args[0]) },
	round: { minArgs: 1, maxArgs: 1, fn: (args) => Math.round(args[0]) },
	sign: { minArgs: 1, maxArgs: 1, fn: (args) => Math.sign(args[0]) },
	limit: {
		minArgs: 3,
		maxArgs: 3,
		fn: (args) => Math.min(Math.max(args[0], args[1]), args[2])
	}
});

function isAssignmentStart(tokens: readonly Token[], index: number): boolean {
	const token = tokens[index];
	return (
		token !== undefined &&
		token.kind === 'identifier' &&
		!token.text.startsWith('.') &&
		tokens[index + 1]?.text === '='
	);
}

class ExpressionParser {
	private index: number;
	private error: string | null = null;

	constructor(
		private readonly tokens: readonly Token[],
		start: number,
		private readonly parameters: ReadonlyMap<string, number>
	) {
		this.index = start;
	}

	parse(): ExpressionResult {
		const value = this.additive();
		if (this.error !== null) return { ok: false, message: this.error };
		if (!Number.isFinite(value)) return { ok: false, message: 'expression is not finite' };
		return { ok: true, value, next: this.index };
	}

	private at(): Token | undefined {
		return this.tokens[this.index];
	}

	private reject(message: string): number {
		if (this.error === null) this.error = message;
		return Number.NaN;
	}

	private additive(): number {
		let value = this.term();
		while (this.error === null) {
			const token = this.at();
			if (token === undefined || (token.text !== '+' && token.text !== '-')) break;
			if (isAssignmentStart(this.tokens, this.index + 1)) break;
			this.index += 1;
			const right = this.term();
			value = token.text === '+' ? value + right : value - right;
		}
		return value;
	}

	private term(): number {
		let value = this.power();
		while (this.error === null) {
			const token = this.at();
			if (token === undefined || (token.text !== '*' && token.text !== '/' && token.text !== '%')) {
				break;
			}
			this.index += 1;
			const right = this.power();
			if (token.text === '*') {
				value *= right;
			} else if (token.text === '/') {
				if (right === 0) return this.reject('division by zero');
				value /= right;
			} else {
				if (right === 0) return this.reject('modulo by zero');
				value %= right;
			}
		}
		return value;
	}

	private power(): number {
		const value = this.unary();
		const token = this.at();
		if (token !== undefined && (token.text === '**' || token.text === '^')) {
			this.index += 1;
			const right = this.power();
			return Math.pow(value, right);
		}
		return value;
	}

	private unary(): number {
		const token = this.at();
		if (token !== undefined && token.text === '-') {
			this.index += 1;
			return -this.unary();
		}
		if (token !== undefined && token.text === '+') {
			this.index += 1;
			return this.unary();
		}
		return this.primary();
	}

	private primary(): number {
		const token = this.at();
		if (token === undefined) return this.reject('expected a value');
		if (token.kind === 'number') {
			const parsed = parseSI(token.text);
			if (!parsed.ok) return this.reject(parsed.error);
			this.index += 1;
			return parsed.value;
		}
		if (token.kind === 'identifier') {
			if (token.text.startsWith('.')) return this.reject(`unexpected token "${token.text}"`);
			if (this.tokens[this.index + 1]?.text === '(') return this.callFunction(token.text);
			const key = token.text.toLowerCase();
			const value = this.parameters.get(key);
			if (value === undefined) return this.reject(`unknown parameter "${token.text}"`);
			this.index += 1;
			return value;
		}
		if (token.text === '(') {
			this.index += 1;
			const value = this.additive();
			if (this.error !== null) return Number.NaN;
			if (this.at()?.text !== ')') return this.reject('missing closing ")"');
			this.index += 1;
			return value;
		}
		if (token.text === '{') return this.reject('nested braces are not supported');
		return this.reject(`unexpected token "${token.text}"`);
	}

	private callFunction(name: string): number {
		const spec = FUNCTIONS[name.toLowerCase()];
		this.index += 2;
		const args: number[] = [];
		if (this.at()?.text === ')') {
			this.index += 1;
		} else {
			for (;;) {
				args.push(this.additive());
				if (this.error !== null) return Number.NaN;
				const separator = this.at();
				if (separator?.text === ',') {
					this.index += 1;
					continue;
				}
				if (separator?.text === ')') {
					this.index += 1;
					break;
				}
				return this.reject('missing closing ")"');
			}
		}
		if (spec === undefined) return this.reject(`unknown function "${name}"`);
		if (args.length < spec.minArgs || args.length > spec.maxArgs) {
			return this.reject(
				`function "${name}" expects between ${spec.minArgs} and ${spec.maxArgs} arguments`
			);
		}
		const value = spec.fn(args);
		if (!Number.isFinite(value)) {
			return this.reject(`function "${name}" returned a non-finite value`);
		}
		return value;
	}
}

export function evaluateExpression(
	tokens: readonly Token[],
	start: number,
	parameters: ReadonlyMap<string, number>
): ExpressionResult {
	return new ExpressionParser(tokens, start, parameters).parse();
}

export function evaluateBraced(
	tokens: readonly Token[],
	start: number,
	parameters: ReadonlyMap<string, number>
): ExpressionResult {
	if (tokens[start]?.text !== '{') {
		return { ok: false, message: 'expected an opening brace' };
	}
	let end = start + 1;
	for (; end < tokens.length; end += 1) {
		const text = tokens[end].text;
		if (text === '}') break;
		if (text === '{') return { ok: false, message: 'nested braces are not supported' };
	}
	if (end >= tokens.length) return { ok: false, message: 'missing closing "}"' };
	const inner = tokens.slice(start + 1, end);
	if (inner.length === 0) return { ok: false, message: 'empty expression' };
	const result = evaluateExpression(inner, 0, parameters);
	if (!result.ok) return result;
	if (result.next !== inner.length) {
		return { ok: false, message: `unexpected token "${inner[result.next]?.text ?? ''}"` };
	}
	return { ok: true, value: result.value, next: end + 1 };
}
