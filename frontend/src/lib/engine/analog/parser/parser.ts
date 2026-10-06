import {
	ModelCaps,
	MODEL_FORMAT_VERSION,
	ModelParseError,
	fail,
	parseFailure,
	type ParseResult,
	type ParsedDefinition,
	type ParsedDeviceModel,
	type ParsedElement,
	type ParsedModel,
	type ParsedSubcircuit
} from './bounds';
import { evaluateBraced, evaluateExpression } from './expressions';
import { tokenizeLine, type Token } from './tokenizer';
import { parseSI } from '../si';

/**
 * Parser for the supported model subset (U8, KTD6): `.model` and `.subckt`
 * definitions with continuation lines, comments, case-insensitive directives,
 * SI suffixes, `.param` definitions, and brace expressions. Every emitted
 * line is rebuilt token by token from parsed values; the raw source text and
 * any unparsed construct are rejected, never forwarded.
 */

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const DESIGNATOR_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const INCLUDE_PREFIXES = ['.include', '.inc', '.lib'];
const UNSUPPORTED_DIRECTIVES = new Set([
	'.end',
	'.control',
	'.global',
	'.option',
	'.options',
	'.temp',
	'.func',
	'.if',
	'.else',
	'.endif',
	'.csparam',
	'.nodeset',
	'.ic',
	'.save',
	'.plot',
	'.probe',
	'.width',
	'.four',
	'.noise',
	'.disto',
	'.sens',
	'.tf',
	'.dc',
	'.ac',
	'.tran',
	'.op',
	'.measure',
	'.step',
	'.alter',
	'.backanno',
	'.connect',
	'.title'
]);

function formatModelNumber(value: number): string {
	if (!Number.isFinite(value)) return '0';
	const normalized = value === 0 ? 0 : Number(value.toPrecision(12));
	if (normalized === 0) return '0';
	const magnitude = Math.abs(normalized);
	if (magnitude >= 1e-4 && magnitude < 1e16) return String(normalized);
	return normalized.toExponential().replace('e+', 'e');
}

function validateName(name: string, what: string): void {
	if (
		typeof name !== 'string' ||
		name.length === 0 ||
		name.length > ModelCaps.maxIdentifierLength ||
		!NAME_PATTERN.test(name)
	) {
		fail(`${what} contains unsupported characters or is too long`);
	}
}

function validateIdentifier(text: string, what: string): void {
	if (text.length > ModelCaps.maxIdentifierLength || !IDENTIFIER_PATTERN.test(text)) {
		fail(`${what} "${text}" is not a supported identifier`);
	}
}

interface LogicalLine {
	text: string;
	line: number;
}

function logicalLines(source: string): LogicalLine[] {
	const physical = source.split('\n');
	if (physical.length > ModelCaps.maxLines) {
		fail(`model text exceeds ${ModelCaps.maxLines} lines`);
	}
	const lines: LogicalLine[] = [];
	let current: LogicalLine | null = null;
	for (let index = 0; index < physical.length; index += 1) {
		const raw = physical[index];
		if (raw.length > ModelCaps.maxLineLength) {
			fail(`line ${index + 1} exceeds ${ModelCaps.maxLineLength} characters`);
		}
		const trimmed = raw.trim();
		if (trimmed === '') {
			if (current !== null) {
				lines.push(current);
				current = null;
			}
			continue;
		}
		if (trimmed.startsWith('*')) continue;
		if (trimmed.startsWith('+')) {
			if (current === null) {
				fail(`line ${index + 1}: continuation without a preceding line`);
			}
			current.text = `${current.text} ${trimmed.slice(1).trim()}`;
			if (current.text.length > ModelCaps.maxLineLength) {
				fail(`line ${index + 1} exceeds ${ModelCaps.maxLineLength} characters`);
			}
			continue;
		}
		if (current !== null) lines.push(current);
		current = { text: trimmed, line: index + 1 };
	}
	if (current !== null) lines.push(current);
	if (lines.length > ModelCaps.maxLines) fail(`model text exceeds ${ModelCaps.maxLines} lines`);
	return lines;
}

function includeAttempt(text: string): string | null {
	const head = text.trimStart().split(/\s+/, 1)[0].toLowerCase();
	if (head.length < 3) return null;
	for (const prefix of INCLUDE_PREFIXES) {
		if (prefix.startsWith(head) || head.startsWith(prefix)) return head;
	}
	return null;
}

interface DeviceDraft {
	kind: 'model';
	def: ParsedDeviceModel;
}

interface SubcktDraft {
	kind: 'subckt';
	name: string;
	terminals: string[];
	parameters: Map<string, number>;
	canonicalHeader: string;
	body: string[];
	elements: ParsedElement[];
	targets: string[];
	nodes: Set<string>;
	finalized: ParsedSubcircuit | null;
}

type Draft = DeviceDraft | SubcktDraft;

interface Scope {
	subckt: SubcktDraft | null;
}

function parseValue(
	tokens: readonly Token[],
	index: number,
	parameters: ReadonlyMap<string, number>
): { value: number; next: number } {
	const token = tokens[index];
	if (token === undefined) fail('expected a value');
	if (token.text === '{') {
		const braced = evaluateBraced(tokens, index, parameters);
		if (!braced.ok) fail(braced.message);
		return { value: braced.value, next: braced.next };
	}
	const result = evaluateExpression(tokens, index, parameters);
	if (!result.ok) fail(result.message);
	return { value: result.value, next: result.next };
}

type AtomKind = 'number' | 'word' | 'open' | 'close' | 'comma' | 'other';

interface Atom {
	text: string;
	kind: AtomKind;
}

function joinAtoms(atoms: readonly Atom[]): string {
	let output = '';
	for (let index = 0; index < atoms.length; index += 1) {
		const atom = atoms[index];
		const previous = atoms[index - 1];
		let glue = index === 0;
		if (!glue && (atom.kind === 'close' || atom.kind === 'comma')) glue = true;
		if (!glue && previous !== undefined && previous.kind === 'open') glue = true;
		if (!glue && atom.kind === 'open' && previous !== undefined && previous.kind === 'word') {
			glue = true;
		}
		output += glue ? atom.text : ` ${atom.text}`;
	}
	return output;
}

function isUnaryPosition(atoms: readonly Atom[]): boolean {
	if (atoms.length === 0) return true;
	const previous = atoms[atoms.length - 1];
	return previous.kind === 'other' || previous.kind === 'open' || previous.kind === 'comma';
}

function canonicalElement(
	tokens: readonly Token[],
	parameters: ReadonlyMap<string, number>,
	scope: Scope
): ParsedElement {
	const designator = tokens[0].text;
	if (!DESIGNATOR_PATTERN.test(designator) || designator.length > ModelCaps.maxIdentifierLength) {
		fail(`element designator "${designator}" is not supported`);
	}
	// The license-clean engine excludes numparam, so instance parameter
	// overrides cannot be evaluated by ngspice; reject them explicitly
	// instead of emitting a deck that fails at solve time.
	if (designator[0]?.toLowerCase() === 'x') {
		for (const token of tokens) {
			if (token.text === '=') {
				fail(
					`subcircuit instance ${designator}: parameter overrides are not supported`
				);
			}
		}
	}
	const atoms: Atom[] = [];
	let pendingSign = '';
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		let atom: Atom;
		if (token.text === '{') {
			const braced = evaluateBraced(tokens, index, parameters);
			if (!braced.ok) fail(braced.message);
			atom = { text: formatModelNumber(braced.value), kind: 'number' };
			index = braced.next - 1;
		} else if (token.kind === 'number') {
			const parsed = parseSI(token.text);
			if (!parsed.ok) fail(parsed.error);
			atom = { text: formatModelNumber(parsed.value), kind: 'number' };
		} else if (token.kind === 'identifier') {
			if (token.text.startsWith('.')) fail(`unsupported directive "${token.text}"`);
			if (index > 0) validateIdentifier(token.text, 'token');
			atom = { text: token.text, kind: 'word' };
		} else {
			const text = token.text;
			if (text === '}') fail('unexpected "}"');
			if (text === '**') fail('operator "**" is only supported inside { } expressions');
			if ((text === '+' || text === '-') && isUnaryPosition(atoms)) {
				pendingSign = text;
				continue;
			}
			const kind: AtomKind =
				text === '(' ? 'open' : text === ')' ? 'close' : text === ',' ? 'comma' : 'other';
			atom = { text, kind };
		}
		if (pendingSign !== '') {
			atom = {
				text: pendingSign + atom.text,
				kind: atom.kind === 'other' ? 'number' : atom.kind
			};
			pendingSign = '';
		}
		atoms.push(atom);
	}
	if (pendingSign !== '') fail('dangling sign in element line');

	if (scope.subckt !== null) {
		scope.subckt.body.push(joinAtoms(atoms));
		scope.subckt.elements.push({ designator, canonical: joinAtoms(atoms) });
		for (let index = 1; index < tokens.length; index += 1) {
			const token = tokens[index];
			if (token.kind !== 'identifier' || token.text.startsWith('.')) continue;
			if (token.text.toLowerCase() === 'params') continue;
			if (tokens[index - 1]?.text === '=' || tokens[index + 1]?.text === '=') continue;
			if (tokens[index + 1]?.text === '(') continue;
			scope.subckt.nodes.add(token.text.toLowerCase());
		}
		if (designator[0]?.toLowerCase() === 'x') {
			let target: string | null = null;
			for (let index = 1; index < tokens.length; index += 1) {
				const token = tokens[index];
				if (token.kind !== 'identifier' || token.text.startsWith('.')) continue;
				if (token.text.toLowerCase() === 'params') continue;
				if (tokens[index - 1]?.text === '=' || tokens[index + 1]?.text === '=') continue;
				if (tokens[index + 1]?.text === '(') continue;
				target = token.text.toLowerCase();
			}
			if (target !== null) scope.subckt.targets.push(target);
		}
	}
	return { designator, canonical: joinAtoms(atoms) };
}

function parameterRecord(map: ReadonlyMap<string, number>): Record<string, number> {
	return Object.fromEntries(map.entries());
}

class ModelParser {
	private readonly definitions: Draft[] = [];
	private readonly subcircuits = new Map<string, SubcktDraft>();
	private readonly deviceNames = new Set<string>();
	private readonly subcircuitNames = new Set<string>();
	private parameterCount = 0;
	private current: SubcktDraft | null = null;
	private currentScope: Map<string, number> | null = null;
	private readonly globalScope = new Map<string, number>();
	private readonly lines: LogicalLine[];
	private lineIndex = 0;

	constructor(source: string) {
		if (source.length > ModelCaps.maxTextLength) {
			fail(`model text exceeds ${ModelCaps.maxTextLength} characters`);
		}
		this.lines = logicalLines(source);
	}

	parse(requestedName: string | null): ParsedModel {
		while (this.lineIndex < this.lines.length) {
			this.parseLine(this.lines[this.lineIndex]);
			this.lineIndex += 1;
		}
		if (this.current !== null) fail('missing .ends for the open .subckt definition');

		const root = this.selectRoot(requestedName);
		const analysis = this.analyze();
		const definitions = this.definitions.map((draft) =>
			draft.kind === 'model' ? draft.def : this.finalizeSubcircuit(draft)
		);
		const canonical: string[] = [];
		for (const definition of definitions) {
			if (definition.kind === 'model') {
				canonical.push(definition.canonical);
			} else {
				canonical.push(
					definition.canonicalHeader,
					...definition.canonicalBody,
					`.ends ${definition.name}`
				);
			}
		}
		let nodes: string[] = [];
		if (root.kind === 'model') {
			return {
				name: root.def.name,
				formatVersion: MODEL_FORMAT_VERSION,
				root: root.def,
				definitions,
				canonical,
				nodes,
				depth: 0,
				expandedInstances: 0
			};
		}
		const rootDefinition = this.finalizeSubcircuit(root);
		nodes = [...rootDefinition.terminals];
		const seen = new Set(nodes.map((node) => node.toLowerCase()));
		for (const node of root.nodes) {
			if (!seen.has(node)) {
				seen.add(node);
				nodes.push(node);
			}
		}
		const rootAnalysis = analysis.get(root.name.toLowerCase()) ?? { depth: 0, count: 0 };
		return {
			name: root.name,
			formatVersion: MODEL_FORMAT_VERSION,
			root: rootDefinition,
			definitions,
			canonical,
			nodes,
			depth: rootAnalysis.depth,
			expandedInstances: rootAnalysis.count
		};
	}

	private parseLine(line: LogicalLine): void {
		const include = includeAttempt(line.text);
		if (include !== null) {
			fail(
				`"${include}" is not supported; .include/.lib imports are not supported, import the referenced definitions explicitly`
			);
		}
		const tokenized = tokenizeLine(line.text);
		if (!tokenized.ok) fail(`line ${line.line}: ${tokenized.message}`);
		const tokens = tokenized.tokens;
		if (tokens.length === 0) return;

		const first = tokens[0];
		const directive = first.kind === 'identifier' && first.text.startsWith('.')
			? first.text.toLowerCase()
			: null;
		if (directive !== null) {
			this.parseDirective(directive, tokens, line);
			return;
		}
		if (this.current === null) {
			fail(`line ${line.line}: expected a .model or .subckt definition`);
		}
		canonicalElement(tokens, this.currentScope ?? this.globalScope, { subckt: this.current });
	}

	private parseDirective(directive: string, tokens: readonly Token[], line: LogicalLine): void {
		switch (directive) {
			case '.model':
				this.parseModelCard(tokens);
				return;
			case '.param':
				this.parseParams(tokens);
				return;
			case '.subckt':
				this.parseSubckt(tokens, line);
				return;
			case '.ends':
				this.parseEnds(tokens);
				return;
			default: {
				if (INCLUDE_PREFIXES.some((prefix) => prefix.startsWith(directive))) {
					fail(
						`"${tokens[0].text}" is not supported; .include/.lib imports are not supported, import the referenced definitions explicitly`
					);
				}
				fail(`unsupported directive "${tokens[0].text}"`);
			}
		}
	}

	private parseModelCard(tokens: readonly Token[]): void {
		const nameToken = tokens[1];
		const typeToken = tokens[2];
		if (nameToken === undefined || typeToken === undefined) {
			fail('.model requires a name and a device type');
		}
		const name = nameToken.text;
		const type = typeToken.text;
		validateIdentifier(name, '.model name');
		if (this.deviceNames.has(name.toLowerCase())) fail(`duplicate .model name "${name}"`);
		this.deviceNames.add(name.toLowerCase());
		validateIdentifier(type, '.model type');

		let index = 3;
		let parenthesized = false;
		if (tokens[index]?.text === '(') {
			parenthesized = true;
			index += 1;
		}
		const pairs: string[] = [];
		let closed = !parenthesized;
		while (index < tokens.length) {
			const token = tokens[index];
			if (parenthesized && token.text === ')') {
				closed = true;
				index += 1;
				break;
			}
			if (token.kind !== 'identifier') {
				fail(`.model ${name}: expected a parameter name, got "${token.text}"`);
			}
			validateIdentifier(token.text, `.model ${name} parameter`);
			if (tokens[index + 1]?.text !== '=') {
				fail(`.model ${name}: parameter "${token.text}" is missing "="`);
			}
			const scope = this.currentScope ?? this.globalScope;
			const value = parseValue(tokens, index + 2, scope);
			this.countParameter();
			pairs.push(`${token.text}=${formatModelNumber(value.value)}`);
			index = value.next;
		}
		if (!closed) fail(`.model ${name}: missing closing ")"`);
		if (index < tokens.length) fail(`.model ${name}: unexpected token "${tokens[index].text}"`);

		const canonical = `.model ${name} ${type}${pairs.length > 0 ? `(${pairs.join(' ')})` : ''}`;
		const definition: ParsedDeviceModel = {
			kind: 'model',
			name,
			type,
			parameters: Object.fromEntries(
				pairs.map((pair) => {
					const [key, value] = pair.split('=');
					return [key, Number(value)];
				})
			),
			canonical
		};
		if (this.current !== null) {
			this.current.body.push(canonical);
		} else {
			this.definitions.push({ kind: 'model', def: definition });
		}
	}

	private parseParams(tokens: readonly Token[]): void {
		let index = 1;
		const scope = this.currentScope ?? this.globalScope;
		while (index < tokens.length) {
			const token = tokens[index];
			if (token.kind !== 'identifier') fail(`.param: expected a parameter name, got "${token.text}"`);
			validateIdentifier(token.text, '.param name');
			if (tokens[index + 1]?.text !== '=') {
				fail(`.param "${token.text}" is missing "="`);
			}
			const value = parseValue(tokens, index + 2, scope);
			this.countParameter();
			scope.set(token.text.toLowerCase(), value.value);
			index = value.next;
		}
	}

	private parseSubckt(tokens: readonly Token[], line: LogicalLine): void {
		if (this.current !== null) fail(`line ${line.line}: nested .subckt definitions are not supported`);
		const nameToken = tokens[1];
		if (nameToken === undefined) fail('.subckt requires a name');
		const name = nameToken.text;
		validateIdentifier(name, '.subckt name');
		if (this.subcircuitNames.has(name.toLowerCase())) fail(`duplicate .subckt name "${name}"`);
		this.subcircuitNames.add(name.toLowerCase());

		const terminals: string[] = [];
		const terminalSet = new Set<string>();
		let index = 2;
		const parameters = new Map<string, number>();
		while (index < tokens.length) {
			const token = tokens[index];
			if (token.kind === 'identifier' && token.text.toLowerCase() === 'params') {
				if (tokens[index + 1]?.text === ':') {
					index += 2;
					break;
				}
			}
			if (token.kind !== 'identifier') {
				fail(`.subckt ${name}: expected a terminal name, got "${token.text}"`);
			}
			validateIdentifier(token.text, `.subckt ${name} terminal`);
			const key = token.text.toLowerCase();
			if (terminalSet.has(key)) fail(`.subckt ${name}: duplicate terminal "${token.text}"`);
			terminalSet.add(key);
			terminals.push(token.text);
			index += 1;
		}
		if (terminals.length === 0) fail(`.subckt ${name}: at least one terminal is required`);

		while (index < tokens.length) {
			const token = tokens[index];
			if (token.kind !== 'identifier') {
				fail(`.subckt ${name}: expected a parameter name, got "${token.text}"`);
			}
			validateIdentifier(token.text, `.subckt ${name} parameter`);
			if (tokens[index + 1]?.text !== '=') {
				fail(`.subckt ${name}: parameter "${token.text}" is missing "="`);
			}
			const value = parseValue(tokens, index + 2, this.globalScope);
			this.countParameter();
			parameters.set(token.text.toLowerCase(), value.value);
			index = value.next;
		}

		// Defaults are folded into the body at parse time and the header drops
		// the `params:` clause: the license-clean engine excludes numparam, so
		// a parameterized header would fail at solve time (KTD1, KTD6).
		const header = `.subckt ${name} ${terminals.join(' ')}`;
		const draft: SubcktDraft = {
			kind: 'subckt',
			name,
			terminals,
			parameters,
			canonicalHeader: header,
			body: [],
			elements: [],
			targets: [],
			nodes: new Set(terminals.map((terminal) => terminal.toLowerCase())),
			finalized: null
		};
		this.current = draft;
		this.currentScope = new Map([...this.globalScope, ...parameters]);
		this.definitions.push(draft);
		this.subcircuits.set(name.toLowerCase(), draft);
	}

	private parseEnds(tokens: readonly Token[]): void {
		if (this.current === null) fail('unexpected .ends without an open .subckt');
		const nameToken = tokens[1];
		if (nameToken !== undefined && nameToken.text.toLowerCase() !== this.current.name.toLowerCase()) {
			fail(`.ends ${nameToken.text} does not match .subckt ${this.current.name}`);
		}
		const extra = tokens[2];
		if (extra !== undefined) fail(`.ends: unexpected token "${extra.text}"`);
		this.finalizeSubcircuit(this.current);
		this.current = null;
		this.currentScope = null;
	}

	private countParameter(): void {
		this.parameterCount += 1;
		if (this.parameterCount > ModelCaps.maxParameters) {
			fail(`parameter count exceeds the cap of ${ModelCaps.maxParameters}`);
		}
	}

	private finalizeSubcircuit(draft: SubcktDraft): ParsedSubcircuit {
		if (draft.finalized !== null) return draft.finalized;
		if (draft.nodes.size > ModelCaps.maxNodes) {
			fail(`node count ${draft.nodes.size} exceeds the cap of ${ModelCaps.maxNodes}`);
		}
		draft.finalized = {
			kind: 'subckt',
			name: draft.name,
			terminals: draft.terminals,
			parameters: parameterRecord(draft.parameters),
			elements: draft.elements,
			canonicalHeader: draft.canonicalHeader,
			canonicalBody: draft.body
		};
		return draft.finalized;
	}

	private selectRoot(requestedName: string | null): Draft {
		if (requestedName !== null) {
			validateName(requestedName, 'model name');
			const lower = requestedName.toLowerCase();
			const matches = this.definitions.filter((draft) =>
				(draft.kind === 'model' ? draft.def.name : draft.name).toLowerCase() === lower
			);
			if (matches.length === 0) fail(`no .model or .subckt named "${requestedName}"`);
			return matches[0];
		}
		if (this.definitions.length === 0) fail('no .model or .subckt definition found');
		return this.definitions[0];
	}

	private analyze(): Map<string, { depth: number; count: number }> {
		const memo = new Map<string, { depth: number; count: number }>();
		const stack: string[] = [];

		const visit = (name: string): { depth: number; count: number } => {
			const cached = memo.get(name);
			if (cached !== undefined) return cached;
			const draft = this.subcircuits.get(name);
			if (draft === undefined) return { depth: 0, count: 0 };
			const cycleAt = stack.indexOf(name);
			if (cycleAt >= 0) {
				fail(`definition cycle: ${[...stack.slice(cycleAt), name].join(' -> ')}`);
			}
			stack.push(name);
			let count = 0;
			let depth = 0;
			for (const target of draft.targets) {
				count += 1;
				if (count > ModelCaps.maxExpandedInstances) {
					fail(
						`expanded instance count exceeds the cap of ${ModelCaps.maxExpandedInstances}`
					);
				}
				const child = visit(target);
				count += child.count;
				if (count > ModelCaps.maxExpandedInstances) {
					fail(
						`expanded instance count exceeds the cap of ${ModelCaps.maxExpandedInstances}`
					);
				}
				depth = Math.max(depth, child.depth + 1);
				if (depth > ModelCaps.maxSubcircuitDepth) {
					fail(
						`nesting depth ${depth} exceeds the cap of ${ModelCaps.maxSubcircuitDepth}`
					);
				}
			}
			stack.pop();
			const result = { depth, count };
			memo.set(name, result);
			return result;
		};

		for (const name of this.subcircuits.keys()) visit(name);
		return memo;
	}
}

export function parseModelSource(requestedName: string | null, source: string): ParseResult {
	try {
		if (typeof source !== 'string') return parseFailure('model source must be text');
		return { ok: true, model: new ModelParser(source).parse(requestedName) };
	} catch (error) {
		if (error instanceof ModelParseError) return parseFailure(error.message);
		throw error;
	}
}

export function validateStoredModels(
	models: readonly { name: string; source: string }[]
): { ok: true } | { ok: false; message: string } {
	for (const model of models) {
		if (
			typeof model?.name !== 'string' ||
			model.name.length === 0 ||
			typeof model.source !== 'string'
		) {
			return { ok: false, message: 'a stored model entry is malformed' };
		}
		const result = parseModelSource(model.name, model.source);
		if (!result.ok) return { ok: false, message: `model ${model.name}: ${result.message}` };
	}
	return { ok: true };
}

export { ModelCaps, MODEL_FORMAT_VERSION, formatModelNumber };
export type { ParseResult, ParsedDefinition, ParsedModel };
