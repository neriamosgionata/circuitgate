import type {
	AnalogAnalysis,
	AnalogAnalysisKind,
	AnalogModel,
	CircuitDocument,
	Component
} from '../../model/circuit';
import { analogKinds, defaultParamsForKind } from './primitives';
import { resolveModel } from './models';
import { parseModelSource } from './parser';

export type NetlistProblemCode =
	| 'unsupported-kind'
	| 'model-unresolved'
	| 'model-unsupported'
	| 'parameter-invalid'
	| 'parameter-cap'
	| 'unconnected-pin'
	| 'analysis-invalid';

export interface NetlistProblem {
	code: NetlistProblemCode;
	message: string;
	componentIds?: string[];
	nets?: string[];
	analysisId?: string;
}

export const AnalysisCaps = {
	maxPoints: 1_000_000,
	maxInternalSteps: 1_000_000,
	maxDurationStepRatio: 1_000_000
} as const;

export const KTD5Defaults = {
	tran: { duration: 1e-3, maxStep: 1e-6 },
	ac: { startHz: 10, stopHz: 1e6, pointsPerDecade: 20 }
} as const;

export function defaultAnalysisParams(kind: AnalogAnalysisKind): Record<string, unknown> {
	switch (kind) {
		case 'op':
			return {};
		case 'tran':
			return { ...KTD5Defaults.tran };
		case 'ac':
			return { ...KTD5Defaults.ac };
		case 'meas':
			return { name: '', type: 'rms', signal: '' };
	}
}

export interface NetlistNodeMap {
	nodes: readonly { net: string; node: string }[];
	nodeForNet(net: string): string | undefined;
	netForNode(node: string): string | undefined;
}

export interface NetlistElementInfo {
	componentId: string;
	kind: string;
	element: string;
	currentVariable?: string;
}

export interface NetlistResult {
	deck: string;
	nodeMap: NetlistNodeMap;
	elements: readonly NetlistElementInfo[];
	problems: readonly NetlistProblem[];
}

export interface NetlistOptions {
	useInitialConditions?: boolean;
}

interface ResolvedModelText {
	name: string;
	terminals: string[] | null;
}

const IDEAL_OPAMP_SUBCKT = 'circuitgate_ideal_opamp';

const IDEAL_OPAMP_LINES = [
	`.subckt ${IDEAL_OPAMP_SUBCKT} inp inn out`,
	'rin inp inn 10meg',
	'eout out 0 inp inn 200000',
	`.ends ${IDEAL_OPAMP_SUBCKT}`
];

function finiteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberText(value: number): string {
	return String(value);
}

function problem(
	code: NetlistProblemCode,
	message: string,
	context: Omit<NetlistProblem, 'code' | 'message'> = {}
): NetlistProblem {
	return { code, message, ...context };
}

function componentParams(component: Component): Record<string, unknown> {
	const defaults = defaultParamsForKind(component.kind) ?? {};
	return { ...defaults, ...(component.params ?? {}) };
}

function paramNumber(
	component: Component,
	name: string,
	problems: NetlistProblem[],
	fallback: number
): number | null {
	const raw = componentParams(component)[name];
	if (raw === undefined) return fallback;
	const value = finiteNumber(raw);
	if (value === null) {
		problems.push(
			problem('parameter-invalid', `${component.kind} ${component.id}: ${name} must be a finite number`, {
				componentIds: [component.id]
			})
		);
		return null;
	}
	return value;
}

function canonicalModelText(
	name: string,
	source: string,
	componentId: string,
	problems: NetlistProblem[]
): { model: ResolvedModelText; lines: string[] } | null {
	// Untrusted model text is re-parsed on every emission and only the
	// canonical re-emission from the parsed structure reaches the deck (KTD6).
	const parsed = parseModelSource(name, source);
	if (!parsed.ok) {
		problems.push(
			problem('model-unsupported', `model ${name}: ${parsed.message}`, {
				componentIds: [componentId]
			})
		);
		return null;
	}
	const terminals =
		parsed.model.root.kind === 'subckt' ? [...parsed.model.root.terminals] : null;
	return {
		model: { name, terminals },
		lines: [...parsed.model.canonical]
	};
}

function analysisTranParams(
	params: Record<string, unknown> | undefined
): { duration: number; maxStep: number } | null {
	const duration = finiteNumber(params?.['duration'] ?? KTD5Defaults.tran.duration);
	const maxStep = finiteNumber(params?.['maxStep'] ?? KTD5Defaults.tran.maxStep);
	if (duration === null || maxStep === null) return null;
	return { duration, maxStep };
}

function analysisAcParams(
	params: Record<string, unknown> | undefined
): { startHz: number; stopHz: number; pointsPerDecade: number } | null {
	const startHz = finiteNumber(params?.['startHz'] ?? KTD5Defaults.ac.startHz);
	const stopHz = finiteNumber(params?.['stopHz'] ?? KTD5Defaults.ac.stopHz);
	const pointsPerDecade = finiteNumber(params?.['pointsPerDecade'] ?? KTD5Defaults.ac.pointsPerDecade);
	if (startHz === null || stopHz === null || pointsPerDecade === null) return null;
	return { startHz, stopHz, pointsPerDecade };
}

export function validateAnalysis(analysis: AnalogAnalysis): NetlistProblem[] {
	const problems: NetlistProblem[] = [];
	const context = { analysisId: analysis.id };
	switch (analysis.kind) {
		case 'op':
			return problems;
		case 'tran': {
			const params = analysisTranParams(analysis.params);
			if (!params || params.duration <= 0 || params.maxStep <= 0) {
				problems.push(problem('parameter-invalid', 'transient duration and maximum step must be positive', context));
				return problems;
			}
			if (params.maxStep > params.duration) {
				problems.push(
					problem('parameter-invalid', 'transient maximum step must not exceed the duration', context)
				);
				return problems;
			}
			const steps = params.duration / params.maxStep;
			if (steps > AnalysisCaps.maxInternalSteps) {
				problems.push(
					problem(
						'parameter-cap',
						`transient needs ${Math.ceil(steps)} internal steps; the cap is ${AnalysisCaps.maxInternalSteps}. Increase the maximum step or shorten the span.`,
						context
					)
				);
			}
			return problems;
		}
		case 'ac': {
			const params = analysisAcParams(analysis.params);
			if (!params || params.startHz <= 0 || params.stopHz <= params.startHz || params.pointsPerDecade <= 0) {
				problems.push(
					problem('parameter-invalid', 'AC sweep needs positive frequencies with stop above start', context)
				);
				return problems;
			}
			const points = params.pointsPerDecade * Math.log10(params.stopHz / params.startHz);
			if (points > AnalysisCaps.maxPoints) {
				problems.push(
					problem(
						'parameter-cap',
						`AC sweep needs ${Math.ceil(points)} points; the cap is ${AnalysisCaps.maxPoints}. Reduce the points per decade or the span.`,
						context
					)
				);
			}
			return problems;
		}
		case 'meas': {
			const name = analysis.params?.['name'];
			const type = analysis.params?.['type'];
			const signal = analysis.params?.['signal'];
			if (typeof name !== 'string' || name.trim().length === 0) {
				problems.push(problem('analysis-invalid', 'measurement name is required', context));
			}
			if (type !== 'power' && type !== 'rms' && type !== 'minmax') {
				problems.push(problem('analysis-invalid', 'measurement type must be power, rms, or minmax', context));
			}
			if (typeof signal !== 'string' || signal.length === 0) {
				problems.push(problem('analysis-invalid', 'measurement signal target is required', context));
			}
		}
	}
	return problems;
}

function analysisCard(
	analysis: AnalogAnalysis,
	options: NetlistOptions,
	problems: NetlistProblem[]
): string | null {
	problems.push(...validateAnalysis(analysis));
	switch (analysis.kind) {
		case 'op':
			return '.op';
		case 'tran': {
			const params = analysisTranParams(analysis.params);
			if (!params) return null;
			const uic = options.useInitialConditions ? ' uic' : '';
			return `.tran ${numberText(params.maxStep)} ${numberText(params.duration)}${uic}`;
		}
		case 'ac': {
			const params = analysisAcParams(analysis.params);
			if (!params) return null;
			return `.ac dec ${numberText(params.pointsPerDecade)} ${numberText(params.startHz)} ${numberText(params.stopHz)}`;
		}
		case 'meas':
			return null;
	}
}

function conductionEdges(component: Component): ReadonlyArray<readonly [string, string]> {
	switch (component.kind) {
		case 'resistor':
		case 'inductor':
		case 'vsource':
		case 'diode':
		case 'led':
		case 'zener':
			return [['p1', 'p2']];
		case 'potentiometer':
			return [
				['p1', 'wiper'],
				['wiper', 'p2']
			];
		case 'switch':
			return componentParams(component)['state'] === 'closed' ? [['p1', 'p2']] : [];
		case 'bjt':
			return [
				['base', 'collector'],
				['base', 'emitter']
			];
		case 'mosfet':
			return [['drain', 'source']];
		default:
			return [];
	}
}

const SUBCIRCUIT_KINDS = new Set([
	'idealOpamp',
	'opamp',
	'comparator',
	'timer555',
	'regulator'
]);

/**
 * Wired pins of a subcircuit-backed device. Real subcircuits provide internal
 * DC paths (input resistance, output stage), so the connectivity check treats
 * each instance's wired pins as one DC-connected group. Without this, every
 * op-amp output is misreported as a floating node.
 */
function wiredSubcircuitPins(component: Component): string[] {
	if (!SUBCIRCUIT_KINDS.has(component.kind)) return [];
	const pins: string[] = [];
	for (const [pin, net] of Object.entries({ ...component.inputs, ...component.outputs })) {
		if (typeof net === 'string' && net.length > 0) pins.push(pin);
	}
	return pins;
}

export function floatingNodes(document: CircuitDocument): { hasGround: boolean; floating: string[] } {
	const groundNets = new Set<string>();
	for (const component of document.components) {
		if (component.kind !== 'ground') continue;
		const net = component.inputs['p1'];
		if (typeof net === 'string' && net.length > 0) groundNets.add(net);
	}
	const hasGround = groundNets.size > 0;

	const orderedNets: string[] = [];
	const seen = new Set<string>();
	for (const component of document.components) {
		for (const net of [...Object.values(component.inputs), ...Object.values(component.outputs)]) {
			if (typeof net === 'string' && net.length > 0 && !seen.has(net)) {
				seen.add(net);
				orderedNets.push(net);
			}
		}
	}

	const parent = new Map<string, string>();
	const find = (value: string): string => {
		let root = value;
		while (parent.get(root) !== root) root = parent.get(root) as string;
		let cursor = value;
		while (cursor !== root) {
			const next = parent.get(cursor) as string;
			parent.set(cursor, root);
			cursor = next;
		}
		return root;
	};
	const ensure = (value: string): void => {
		if (!parent.has(value)) parent.set(value, value);
	};
	const union = (a: string, b: string): void => {
		ensure(a);
		ensure(b);
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) parent.set(rootA, rootB);
	};

	const GROUND = '\u0000ground';
	if (hasGround) {
		ensure(GROUND);
		for (const net of groundNets) union(net, GROUND);
	}
	for (const net of orderedNets) ensure(net);

	const pinNode = (component: Component, pin: string): string => {
		const net = component.inputs[pin] ?? component.outputs[pin];
		if (net !== undefined && net !== '') {
			ensure(net);
			return net;
		}
		if (hasGround) return GROUND;
		const synthetic = `\u0000${component.id}:${pin}`;
		ensure(synthetic);
		return synthetic;
	};

	for (const component of document.components) {
		for (const [a, b] of conductionEdges(component)) {
			union(pinNode(component, a), pinNode(component, b));
		}
		const subcircuitPins = wiredSubcircuitPins(component);
		for (let index = 1; index < subcircuitPins.length; index += 1) {
			union(pinNode(component, subcircuitPins[0]), pinNode(component, subcircuitPins[index]));
		}
	}

	const floating = hasGround
		? orderedNets.filter((net) => find(net) !== find(GROUND))
		: [...orderedNets];
	return { hasGround, floating };
}

function formatSourceSpec(component: Component, problems: NetlistProblem[]): string | null {
	const params = componentParams(component);
	const valueName = component.kind === 'isource' ? 'current' : 'voltage';
	const value = paramNumber(component, valueName, problems, component.kind === 'isource' ? 1e-3 : 5);
	if (value === null) return null;
	const offset = paramNumber(component, 'offset', problems, 0);
	const delay = paramNumber(component, 'delay', problems, 0);
	const rise = paramNumber(component, 'rise', problems, 1e-6);
	const fall = paramNumber(component, 'fall', problems, 1e-6);
	const frequency = paramNumber(component, 'frequency', problems, 1000);
	if (offset === null || delay === null || rise === null || fall === null || frequency === null) return null;

	const waveform = params['waveform'] ?? 'dc';
	switch (waveform) {
		case 'sine':
			return `SIN(${numberText(offset)} ${numberText(value)} ${numberText(frequency)} ${numberText(delay)}) AC ${numberText(value)}`;
		case 'pulse': {
			if (frequency <= 0) {
				problems.push(
					problem('parameter-invalid', `${component.kind} ${component.id}: frequency must be positive`, {
						componentIds: [component.id]
					})
				);
				return null;
			}
			const period = 1 / frequency;
			const width = period / 2;
			return `PULSE(${numberText(offset)} ${numberText(offset + value)} ${numberText(delay)} ${numberText(rise)} ${numberText(fall)} ${numberText(width)} ${numberText(period)})`;
		}
		case 'step':
			return `PWL(0 ${numberText(offset)} ${numberText(delay)} ${numberText(offset)} ${numberText(delay + rise)} ${numberText(offset + value)})`;
		default:
			return `DC ${numberText(value)}`;
	}
}

export function emitNetlist(
	document: CircuitDocument,
	analysis: AnalogAnalysis | null = null,
	options: NetlistOptions = {}
): NetlistResult {
	const problems: NetlistProblem[] = [];
	const importedModels: readonly AnalogModel[] = document.models ?? [];

	const groundNets = new Set<string>();
	for (const component of document.components) {
		if (component.kind !== 'ground') continue;
		const net = component.inputs['p1'];
		if (typeof net === 'string' && net.length > 0) groundNets.add(net);
	}
	const hasGround = groundNets.size > 0;

	const nodes = new Map<string, string>();
	const netsByNode = new Map<string, string>();
	for (const net of groundNets) {
		nodes.set(net, '0');
		if (!netsByNode.has('0')) netsByNode.set('0', net);
	}
	const usedSynthetic = new Set<string>();
	let syntheticCounter = 0;

	const nodeName = (net: string): string => {
		if (groundNets.has(net)) return '0';
		const existing = nodes.get(net);
		if (existing !== undefined) return existing;
		let base = net.replace(/[^A-Za-z0-9_]/g, '_');
		if (!/^[A-Za-z_]/.test(base)) base = `n${base}`;
		if (base.length === 0) base = `n${syntheticCounter++}`;
		let candidate = base;
		let suffix = 1;
		while (netsByNode.has(candidate) || usedSynthetic.has(candidate)) {
			candidate = `${base}_${suffix}`;
			suffix += 1;
		}
		nodes.set(net, candidate);
		netsByNode.set(candidate, net);
		return candidate;
	};

	const internalNode = (label: string): string => {
		let base = label.replace(/[^A-Za-z0-9_]/g, '_');
		if (!/^[A-Za-z_]/.test(base)) base = `n${base}`;
		if (base.length === 0) base = `n${syntheticCounter++}`;
		let candidate = base;
		let suffix = 1;
		while (netsByNode.has(candidate) || usedSynthetic.has(candidate)) {
			candidate = `${base}_${suffix}`;
			suffix += 1;
		}
		usedSynthetic.add(candidate);
		return candidate;
	};

	const counters: Record<string, number> = { R: 0, C: 0, L: 0, V: 0, I: 0, D: 0, Q: 0, M: 0, X: 0 };
	const nextElement = (prefix: string): string => {
		counters[prefix] += 1;
		return `${prefix}${counters[prefix]}`;
	};

	const cards: string[] = [];
	const elements: NetlistElementInfo[] = [];
	const modelLines: string[] = [];
	const emittedModels = new Map<string, ResolvedModelText>();
	let idealOpampUsed = false;

	const pinNode = (component: Component, element: string, pin: string): string => {
		const net = component.inputs[pin] ?? component.outputs[pin];
		if (net !== undefined && net !== '') return nodeName(net);
		return hasGround ? '0' : internalNode(`${element}_${pin}`);
	};

	const modelFor = (component: Component, name: unknown): ResolvedModelText | null => {
		if (typeof name !== 'string' || name.length === 0) {
			problems.push(
				problem('model-unresolved', `${component.kind} ${component.id}: missing model reference`, {
					componentIds: [component.id]
				})
			);
			return null;
		}
		const cached = emittedModels.get(name);
		if (cached) return cached;
		const resolved = resolveModel(name, importedModels);
		if (!resolved) {
			problems.push(
				problem('model-unresolved', `${component.kind} ${component.id}: unresolved model ${name}`, {
					componentIds: [component.id]
				})
			);
			return null;
		}
		const canonical = canonicalModelText(name, resolved.text, component.id, problems);
		if (!canonical) return null;
		modelLines.push(...canonical.lines);
		emittedModels.set(name, canonical.model);
		return canonical.model;
	};

	for (const component of document.components) {
		const kindDef = analogKinds[component.kind];
		if (!kindDef) {
			problems.push(
				problem('unsupported-kind', `unsupported analog kind ${component.kind}`, {
					componentIds: [component.id]
				})
			);
			continue;
		}
		switch (component.kind) {
			case 'ground':
				continue;
			case 'resistor': {
				const value = paramNumber(component, 'resistance', problems, 1000);
				if (value === null) continue;
				const element = nextElement('R');
				cards.push(`${element} ${pinNode(component, element, 'p1')} ${pinNode(component, element, 'p2')} ${numberText(value)}`);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'capacitor': {
				const value = paramNumber(component, 'capacitance', problems, 1e-6);
				if (value === null) continue;
				const element = nextElement('C');
				cards.push(`${element} ${pinNode(component, element, 'p1')} ${pinNode(component, element, 'p2')} ${numberText(value)}`);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'inductor': {
				const value = paramNumber(component, 'inductance', problems, 1e-3);
				if (value === null) continue;
				const element = nextElement('L');
				cards.push(`${element} ${pinNode(component, element, 'p1')} ${pinNode(component, element, 'p2')} ${numberText(value)}`);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'switch': {
				const closed = componentParams(component)['state'] === 'closed';
				const element = nextElement('R');
				cards.push(
					`${element} ${pinNode(component, element, 'p1')} ${pinNode(component, element, 'p2')} ${closed ? '0.001' : '1000000000000'}`
				);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'potentiometer': {
				const resistance = paramNumber(component, 'resistance', problems, 10000);
				const position = paramNumber(component, 'position', problems, 0.5);
				if (resistance === null || position === null) continue;
				const clamped = Math.min(1, Math.max(0, position));
				const lower = nextElement('R');
				const upper = nextElement('R');
				cards.push(
					`${lower} ${pinNode(component, lower, 'p1')} ${pinNode(component, lower, 'wiper')} ${numberText(Math.max(resistance * clamped, 0.001))}`
				);
				cards.push(
					`${upper} ${pinNode(component, upper, 'wiper')} ${pinNode(component, upper, 'p2')} ${numberText(Math.max(resistance * (1 - clamped), 0.001))}`
				);
				elements.push({ componentId: component.id, kind: component.kind, element: lower });
				continue;
			}
			case 'vsource':
			case 'isource': {
				const spec = formatSourceSpec(component, problems);
				if (spec === null) continue;
				const element = nextElement(component.kind === 'vsource' ? 'V' : 'I');
				const positive = pinNode(component, element, 'p2');
				const negative = pinNode(component, element, 'p1');
				cards.push(`${element} ${positive} ${negative} ${spec}`);
				elements.push({
					componentId: component.id,
					kind: component.kind,
					element,
					...(component.kind === 'vsource'
						? { currentVariable: `i(${element.toLowerCase()})` }
						: {})
				});
				continue;
			}
			case 'diode':
			case 'led':
			case 'zener': {
				const modelName = componentParams(component)['model'];
				const model = modelFor(component, modelName);
				if (!model) continue;
				const element = nextElement('D');
				cards.push(`${element} ${pinNode(component, element, 'p1')} ${pinNode(component, element, 'p2')} ${model.name}`);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'bjt': {
				const model = modelFor(component, componentParams(component)['model']);
				if (!model) continue;
				const element = nextElement('Q');
				cards.push(
					`${element} ${pinNode(component, element, 'collector')} ${pinNode(component, element, 'base')} ${pinNode(component, element, 'emitter')} ${model.name}`
				);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'mosfet': {
				const model = modelFor(component, componentParams(component)['model']);
				if (!model) continue;
				const element = nextElement('M');
				cards.push(
					`${element} ${pinNode(component, element, 'drain')} ${pinNode(component, element, 'gate')} ${pinNode(component, element, 'source')} 0 ${model.name}`
				);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'idealOpamp': {
				idealOpampUsed = true;
				const element = nextElement('X');
				cards.push(
					`${element} ${pinNode(component, element, 'inp')} ${pinNode(component, element, 'inn')} ${pinNode(component, element, 'out')} ${IDEAL_OPAMP_SUBCKT}`
				);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			case 'opamp':
			case 'comparator':
			case 'timer555':
			case 'regulator': {
				const model = modelFor(component, componentParams(component)['model']);
				if (!model) continue;
				if (!model.terminals) {
					problems.push(
						problem(
							'model-unsupported',
							`${component.kind} ${component.id}: model ${model.name} has no .subckt terminal list`,
							{ componentIds: [component.id] }
						)
					);
					continue;
				}
				const element = nextElement('X');
				const nodes: string[] = [];
				for (const terminal of model.terminals) {
					const declared = component.inputs[terminal] ?? component.outputs[terminal];
					const known = kindDef.inputs.includes(terminal) || kindDef.outputs.includes(terminal);
					if (declared === undefined && !known) {
						problems.push(
							problem(
								'unconnected-pin',
								`${component.kind} ${component.id}: model terminal ${terminal} has no matching pin`,
								{ componentIds: [component.id] }
							)
						);
					}
					nodes.push(pinNode(component, element, terminal));
				}
				cards.push(`${element} ${nodes.join(' ')} ${model.name}`);
				elements.push({ componentId: component.id, kind: component.kind, element });
				continue;
			}
			default:
				problems.push(
					problem('unsupported-kind', `unsupported analog kind ${component.kind}`, {
						componentIds: [component.id]
					})
				);
		}
	}

	const deckLines: string[] = ['* CircuitGate analog netlist'];
	if (idealOpampUsed) deckLines.push(...IDEAL_OPAMP_LINES);
	deckLines.push(...modelLines, ...cards);
	if (analysis) {
		const card = analysisCard(analysis, options, problems);
		if (card) deckLines.push(card);
	}
	deckLines.push('.end');

	const nodeList = [...nodes.entries()].map(([net, node]) => ({ net, node }));
	const nodeMap: NetlistNodeMap = {
		nodes: nodeList,
		nodeForNet: (net) => nodes.get(net),
		netForNode: (node) => netsByNode.get(node)
	};

	return { deck: `${deckLines.join('\n')}\n`, nodeMap, elements, problems };
}
