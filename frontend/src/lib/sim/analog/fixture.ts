import type { Diagnostic } from '../diagnostics';
import type { MeasurementOutcome } from './measurements';
import type { ResultStatus } from './results';
import type { AnalysisOutcome } from './results';
import type { AnalogAnalysisKind, AnalogResultVariable } from './protocol';

/**
 * Documented result-fixture shape (see tests/fixtures/analog-results/README.md).
 * Fixtures let the inspection views render without the engine: the e2e harness
 * assigns one to `globalThis.__circuitgateAnalogResultsFixture` before the app
 * boots and the analysis panel seeds its results from it.
 */
export const FIXTURE_GLOBAL = '__circuitgateAnalogResultsFixture';
export const FIXTURE_SHAPE_VERSION = 1;

export interface FixtureDiagnostic {
	code?: string;
	message: string;
}

export interface FixtureVariable {
	name: string;
	type: string;
	real: readonly number[] | Float64Array;
	imag?: readonly number[] | Float64Array;
}

export interface FixtureAnalysis {
	id: string;
	kind: AnalogAnalysisKind;
	status?: ResultStatus;
	stateLabel?: string;
	durationMs?: number;
	diagnostic?: FixtureDiagnostic;
	variables: FixtureVariable[];
}

export interface FixtureMeasurement {
	analysisId?: string;
	name: string;
	type: string;
	signal: string;
	status?: 'complete' | 'failed';
	value?: number;
	min?: number;
	max?: number;
	samples?: number;
	diagnostic?: FixtureDiagnostic;
}

export interface AnalogResultsFixture {
	shapeVersion: number;
	lastCompletedKind?: AnalogAnalysisKind;
	analyses: FixtureAnalysis[];
	measurements?: FixtureMeasurement[];
}

const ANALYSIS_KINDS: ReadonlySet<string> = new Set(['op', 'tran', 'ac']);
const RESULT_STATUSES: ReadonlySet<string> = new Set(['complete', 'failed', 'suppressed']);
const MEASUREMENT_TYPES: ReadonlySet<string> = new Set(['power', 'rms', 'minmax']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberSequence(value: unknown): value is readonly number[] | Float64Array {
	if (value instanceof Float64Array) return true;
	if (!Array.isArray(value)) return false;
	return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function parseDiagnostic(value: unknown): FixtureDiagnostic | null {
	if (!isRecord(value) || typeof value['message'] !== 'string') return null;
	return {
		message: value['message'],
		...(typeof value['code'] === 'string' ? { code: value['code'] } : {})
	};
}

function parseVariable(value: unknown): FixtureVariable | null {
	if (!isRecord(value)) return null;
	if (typeof value['name'] !== 'string' || typeof value['type'] !== 'string') return null;
	if (!numberSequence(value['real'])) return null;
	if (value['imag'] !== undefined && !numberSequence(value['imag'])) return null;
	return {
		name: value['name'],
		type: value['type'],
		real: value['real'],
		...(value['imag'] === undefined ? {} : { imag: value['imag'] as number[] | Float64Array })
	};
}

function parseAnalysis(value: unknown): FixtureAnalysis | null {
	if (!isRecord(value)) return null;
	if (typeof value['id'] !== 'string' || typeof value['kind'] !== 'string') return null;
	if (!ANALYSIS_KINDS.has(value['kind'])) return null;
	if (!Array.isArray(value['variables'])) return null;
	const variables: FixtureVariable[] = [];
	for (const entry of value['variables']) {
		const variable = parseVariable(entry);
		if (!variable) return null;
		variables.push(variable);
	}
	const status =
		typeof value['status'] === 'string' && RESULT_STATUSES.has(value['status'])
			? (value['status'] as ResultStatus)
			: 'complete';
	const diagnostic = parseDiagnostic(value['diagnostic']);
	return {
		id: value['id'],
		kind: value['kind'] as AnalogAnalysisKind,
		status,
		variables,
		...(typeof value['stateLabel'] === 'string' ? { stateLabel: value['stateLabel'] } : {}),
		...(typeof value['durationMs'] === 'number' ? { durationMs: value['durationMs'] } : {}),
		...(diagnostic ? { diagnostic } : {})
	};
}

function parseMeasurement(value: unknown): FixtureMeasurement | null {
	if (!isRecord(value)) return null;
	if (
		typeof value['name'] !== 'string' ||
		typeof value['type'] !== 'string' ||
		!MEASUREMENT_TYPES.has(value['type']) ||
		typeof value['signal'] !== 'string'
	) {
		return null;
	}
	const diagnostic = parseDiagnostic(value['diagnostic']);
	return {
		name: value['name'],
		type: value['type'],
		signal: value['signal'],
		...(typeof value['analysisId'] === 'string' ? { analysisId: value['analysisId'] } : {}),
		...(value['status'] === 'failed' ? { status: 'failed' as const } : { status: 'complete' as const }),
		...(typeof value['value'] === 'number' ? { value: value['value'] } : {}),
		...(typeof value['min'] === 'number' ? { min: value['min'] } : {}),
		...(typeof value['max'] === 'number' ? { max: value['max'] } : {}),
		...(typeof value['samples'] === 'number' ? { samples: value['samples'] } : {}),
		...(diagnostic ? { diagnostic } : {})
	};
}

/** Strict-enough shape check; returns null for anything unrecognized. */
export function parseAnalogResultsFixture(value: unknown): AnalogResultsFixture | null {
	if (!isRecord(value) || value['shapeVersion'] !== FIXTURE_SHAPE_VERSION) return null;
	if (!Array.isArray(value['analyses'])) return null;
	const analyses: FixtureAnalysis[] = [];
	for (const entry of value['analyses']) {
		const analysis = parseAnalysis(entry);
		if (!analysis) return null;
		analyses.push(analysis);
	}
	const measurements: FixtureMeasurement[] = [];
	if (value['measurements'] !== undefined) {
		if (!Array.isArray(value['measurements'])) return null;
		for (const entry of value['measurements']) {
			const measurement = parseMeasurement(entry);
			if (!measurement) return null;
			measurements.push(measurement);
		}
	}
	const lastCompletedKind =
		typeof value['lastCompletedKind'] === 'string' && ANALYSIS_KINDS.has(value['lastCompletedKind'])
			? (value['lastCompletedKind'] as AnalogAnalysisKind)
			: undefined;
	return {
		shapeVersion: FIXTURE_SHAPE_VERSION,
		...(lastCompletedKind === undefined ? {} : { lastCompletedKind }),
		analyses,
		measurements
	};
}

export function takeInjectedFixture(): AnalogResultsFixture | null {
	const candidate = (globalThis as Record<string, unknown>)[FIXTURE_GLOBAL];
	return parseAnalogResultsFixture(candidate);
}

function toFloat64Array(sequence: readonly number[] | Float64Array): Float64Array {
	// Injected typed arrays are read-only for the views; reuse them so a large
	// procedural fixture is not copied twice on the way to the views.
	return sequence instanceof Float64Array ? sequence : Float64Array.from(sequence);
}

function toVariable(variable: FixtureVariable): AnalogResultVariable {
	return {
		name: variable.name,
		type: variable.type,
		real: toFloat64Array(variable.real),
		...(variable.imag === undefined ? {} : { imag: toFloat64Array(variable.imag) })
	};
}

function fixtureDiagnostic(
	id: string,
	code: string,
	message: string,
	analysisId: string
): Diagnostic {
	return { id, kind: 'analog', code, message, analysisId };
}

export function fixtureToOutcomes(fixture: AnalogResultsFixture): {
	outcomes: AnalysisOutcome[];
	measurements: MeasurementOutcome[];
} {
	const outcomes = fixture.analyses.map((analysis) => ({
		analysisId: analysis.id,
		kind: analysis.kind,
		status: analysis.status ?? 'complete',
		variables: analysis.variables.map(toVariable),
		...(analysis.stateLabel === undefined ? {} : { stateLabel: analysis.stateLabel }),
		...(analysis.durationMs === undefined ? {} : { durationMs: analysis.durationMs }),
		...(analysis.diagnostic
			? {
					diagnostic: fixtureDiagnostic(
						`fixture:${analysis.id}`,
						analysis.diagnostic.code ?? 'solver',
						analysis.diagnostic.message,
						analysis.id
					)
				}
			: {})
	}));
	const measurements = (fixture.measurements ?? []).map((measurement) => ({
		analysisId: measurement.analysisId ?? measurement.name,
		name: measurement.name,
		type: measurement.type as MeasurementOutcome['type'],
		signal: measurement.signal,
		status: measurement.status ?? 'complete',
		...(measurement.value === undefined ? {} : { value: measurement.value }),
		...(measurement.min === undefined ? {} : { min: measurement.min }),
		...(measurement.max === undefined ? {} : { max: measurement.max }),
		...(measurement.samples === undefined ? {} : { samples: measurement.samples }),
		...(measurement.diagnostic
			? {
					diagnostic: fixtureDiagnostic(
						`fixture:meas:${measurement.name}`,
						measurement.diagnostic.code ?? 'unbound-measurement',
						measurement.diagnostic.message,
						measurement.analysisId ?? measurement.name
					)
				}
			: {})
	}));
	return { outcomes, measurements };
}
