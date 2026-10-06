/**
 * Analog device-kind registry (U5). Analog kinds live here, never in the
 * digital `primitiveKinds` registry, so the digital compile path cannot
 * accept them. Pin direction is an editor affordance only (KTD4):
 * two-terminal devices expose `p1` (input) and `p2` (output); the one-pin
 * ground is declared an input so device outputs can terminate on it under
 * the store's same-side wiring rule.
 */
export type AnalogModelClass =
	| 'opamp'
	| 'comparator'
	| 'timer'
	| 'regulator'
	| 'diode'
	| 'bjt'
	| 'mosfet';

export interface AnalogParameterSpec {
	name: string;
	kind: 'number' | 'string' | 'enum';
	defaultValue: unknown;
	options?: readonly string[];
	unit?: string;
}

export interface AnalogKind {
	domain: 'analog';
	inputs: readonly string[];
	outputs: readonly string[];
	parameters: readonly AnalogParameterSpec[];
	modelClass?: AnalogModelClass;
	defaultParams: Readonly<Record<string, unknown>>;
}

function kind(
	inputs: readonly string[],
	outputs: readonly string[],
	parameters: readonly AnalogParameterSpec[],
	defaultParams: Record<string, unknown>,
	modelClass?: AnalogModelClass
): AnalogKind {
	const defaults: Record<string, unknown> = {};
	for (const parameter of parameters) {
		if (parameter.defaultValue !== undefined) defaults[parameter.name] = parameter.defaultValue;
	}
	return {
		domain: 'analog',
		inputs,
		outputs,
		parameters,
		defaultParams: Object.freeze({ ...defaults, ...defaultParams }),
		modelClass
	};
}

const WAVEFORMS = ['dc', 'sine', 'pulse', 'step'] as const;

function sourceParams(quantity: 'voltage' | 'current'): AnalogParameterSpec[] {
	return [
		{ name: 'waveform', kind: 'enum', options: WAVEFORMS, defaultValue: 'dc' },
		{ name: quantity, kind: 'number', defaultValue: quantity === 'voltage' ? 5 : 1e-3 },
		{ name: 'offset', kind: 'number', defaultValue: 0 },
		{ name: 'frequency', kind: 'number', unit: 'Hz', defaultValue: 1000 },
		{ name: 'delay', kind: 'number', unit: 's', defaultValue: 0 },
		{ name: 'rise', kind: 'number', unit: 's', defaultValue: 1e-6 },
		{ name: 'fall', kind: 'number', unit: 's', defaultValue: 1e-6 }
	];
}

export const analogKinds: Readonly<Record<string, AnalogKind>> = Object.freeze({
	vsource: kind(['p1'], ['p2'], sourceParams('voltage'), {
		waveform: 'dc',
		voltage: 5
	}),
	isource: kind(['p1'], ['p2'], sourceParams('current'), {
		waveform: 'dc',
		current: 1e-3
	}),
	resistor: kind(
		['p1'],
		['p2'],
		[{ name: 'resistance', kind: 'number', unit: '\u03a9', defaultValue: 1000 }],
		{ resistance: 1000 }
	),
	capacitor: kind(
		['p1'],
		['p2'],
		[{ name: 'capacitance', kind: 'number', unit: 'F', defaultValue: 1e-6 }],
		{ capacitance: 1e-6 }
	),
	inductor: kind(
		['p1'],
		['p2'],
		[{ name: 'inductance', kind: 'number', unit: 'H', defaultValue: 1e-3 }],
		{ inductance: 1e-3 }
	),
	switch: kind(
		['p1'],
		['p2'],
		[
			{
				name: 'state',
				kind: 'enum',
				options: ['open', 'closed'],
				defaultValue: 'open'
			}
		],
		{ state: 'open' }
	),
	potentiometer: kind(
		['p1'],
		['p2', 'wiper'],
		[
			{ name: 'resistance', kind: 'number', unit: '\u03a9', defaultValue: 10000 },
			{ name: 'position', kind: 'number', defaultValue: 0.5 }
		],
		{ resistance: 10000, position: 0.5 }
	),
	diode: kind(
		['p1'],
		['p2'],
		[{ name: 'model', kind: 'string', defaultValue: 'd1n4148' }],
		{ model: 'd1n4148' },
		'diode'
	),
	led: kind(
		['p1'],
		['p2'],
		[{ name: 'model', kind: 'string', defaultValue: 'ledred' }],
		{ model: 'ledred' },
		'diode'
	),
	zener: kind(
		['p1'],
		['p2'],
		[{ name: 'model', kind: 'string', defaultValue: 'd1n4733' }],
		{ model: 'd1n4733' },
		'diode'
	),
	bjt: kind(
		['base', 'collector'],
		['emitter'],
		[{ name: 'model', kind: 'string', defaultValue: 'q2n2222' }],
		{ model: 'q2n2222' },
		'bjt'
	),
	mosfet: kind(
		['gate', 'drain'],
		['source'],
		[{ name: 'model', kind: 'string', defaultValue: 'm2n7000' }],
		{ model: 'm2n7000' },
		'mosfet'
	),
	// The ideal op-amp is model-free by design; curated real-device models
	// (741/TL072-class) attach through the model-backed `opamp` kind.
	idealOpamp: kind(['inp', 'inn'], ['out'], [], {}),
	opamp: kind(
		['inp', 'inn', 'vcc', 'vee'],
		['out'],
		[{ name: 'model', kind: 'string', defaultValue: 'opamp741' }],
		{ model: 'opamp741' },
		'opamp'
	),
	comparator: kind(
		['inp', 'inn', 'vcc', 'vee'],
		['out'],
		[{ name: 'model', kind: 'string', defaultValue: 'lm393' }],
		{ model: 'lm393' },
		'comparator'
	),
	timer555: kind(
		['trig', 'thresh', 'reset', 'ctrl', 'vcc'],
		['out', 'disch', 'gnd'],
		[{ name: 'model', kind: 'string', defaultValue: 'timer555' }],
		{ model: 'timer555' },
		'timer'
	),
	regulator: kind(
		['vin'],
		['vout', 'gnd'],
		[{ name: 'model', kind: 'string', defaultValue: 'lm7805' }],
		{ model: 'lm7805' },
		'regulator'
	),
	// Single reference pin, declared an input so device outputs terminate here.
	ground: kind(['p1'], [], [], {})
});

export const ANALOG_KIND_NAMES: readonly string[] = Object.keys(analogKinds);

export function analogKind(kindName: string): AnalogKind | null {
	return analogKinds[kindName] ?? null;
}

export function isModelBackedKind(kindName: string): boolean {
	return analogKinds[kindName]?.modelClass !== undefined;
}

export function defaultParamsForKind(kindName: string): Readonly<Record<string, unknown>> | null {
	return analogKinds[kindName]?.defaultParams ?? null;
}
