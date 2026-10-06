import { parseSI } from '../si';
import { ModelCaps, type ParseFailure } from './bounds';

/**
 * Character-scanner tokenizer for the model subset (U8). It performs no
 * backtracking: one linear pass per line, bounded line and token lengths,
 * comments stripped, operators emitted as single tokens.
 */

export type TokenKind = 'identifier' | 'number' | 'operator';

export interface Token {
	kind: TokenKind;
	text: string;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | ParseFailure;

const WORD_START = /[A-Za-z0-9_.]/;
const WORD_CHAR = /[A-Za-z0-9_.]/;

function isDigit(char: string | undefined): boolean {
	return char !== undefined && char >= '0' && char <= '9';
}

function classifyWord(text: string): TokenKind {
	return parseSI(text).ok ? 'number' : 'identifier';
}

export function tokenizeLine(line: string): TokenizeResult {
	const tokens: Token[] = [];
	let index = 0;
	while (index < line.length) {
		const char = line[index];
		if (char === ' ' || char === '\t' || char === '\r') {
			index += 1;
			continue;
		}
		if (char === ';' || char === '$') break;
		if ('(),=?:{}'.includes(char)) {
			tokens.push({ kind: 'operator', text: char });
			index += 1;
			if (tokens.length > ModelCaps.maxTokensPerLine) {
				return { ok: false, message: `line exceeds ${ModelCaps.maxTokensPerLine} tokens` };
			}
			continue;
		}
		const pair = line.slice(index, index + 2);
		if (pair === '**' || pair === '<=' || pair === '>=' || pair === '==' || pair === '!=') {
			tokens.push({ kind: 'operator', text: pair });
			index += 2;
			if (tokens.length > ModelCaps.maxTokensPerLine) {
				return { ok: false, message: `line exceeds ${ModelCaps.maxTokensPerLine} tokens` };
			}
			continue;
		}
		if ('+-*/%^<>'.includes(char)) {
			tokens.push({ kind: 'operator', text: char });
			index += 1;
			if (tokens.length > ModelCaps.maxTokensPerLine) {
				return { ok: false, message: `line exceeds ${ModelCaps.maxTokensPerLine} tokens` };
			}
			continue;
		}
		if (WORD_START.test(char)) {
			let end = index + 1;
			while (end < line.length) {
				const candidate = line[end];
				if (WORD_CHAR.test(candidate)) {
					end += 1;
					continue;
				}
				// Exponent signs stay inside the number token (1e-14).
				if (
					(candidate === '+' || candidate === '-') &&
					(line[end - 1] === 'e' || line[end - 1] === 'E') &&
					isDigit(line[end + 1])
				) {
					end += 2;
					continue;
				}
				break;
			}
			const text = line.slice(index, end);
			if (text.length > ModelCaps.maxTokenLength) {
				return {
					ok: false,
					message: `token longer than ${ModelCaps.maxTokenLength} characters`
				};
			}
			tokens.push({ kind: classifyWord(text), text });
			index = end;
			if (tokens.length > ModelCaps.maxTokensPerLine) {
				return { ok: false, message: `line exceeds ${ModelCaps.maxTokensPerLine} tokens` };
			}
			continue;
		}
		return {
			ok: false,
			message: `unsupported character "${char}" at column ${index + 1}`
		};
	}
	return { ok: true, tokens };
}
