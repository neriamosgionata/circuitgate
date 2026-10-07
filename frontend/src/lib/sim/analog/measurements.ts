import { formatSI } from '../../engine/analog/si';
import type { Diagnostic } from '../diagnostics';
import { unboundMeasurementDiagnostic } from './diagnostics';
import type { AnalogResultVariable } from './protocol';

/**
 * Measurement computation for configured measurement definitions. RMS is the
 * square root of the mean square, power is the mean square of the bound
 * signal, and min/max reports both extremes; a window restricts the samples.
 */

export type MeasurementType = 'power' | 'rms' | 'minmax';

export interface MeasurementWindow {
	start?: number;
	stop?: number;
}

export interface MeasurementDefinition {
	/** The analysis entry id; failed outcomes are reported against it. */
	id: string;
	name: string;
	type: MeasurementType;
	signal: string;
	window?: MeasurementWindow;
}

export interface MeasurementSource {
	analysisId: string;
	variables: readonly AnalogResultVariable[];
}

export interface MeasurementOutcome {
	analysisId: string;
	name: string;
	type: MeasurementType;
	signal: string;
	status: 'complete' | 'failed';
	value?: number;
	min?: number;
	max?: number;
	samples?: number;
	diagnostic?: Diagnostic;
}

export function axisFor(variables: readonly AnalogResultVariable[]): AnalogResultVariable | undefined {
	return (
		variables.find((variable) => variable.type === 'time') ??
		variables.find((variable) => variable.type === 'frequency') ??
		variables.find((variable) => variable.name === 'time' || variable.name === 'frequency')
	);
}

function magnitudeAt(variable: AnalogResultVariable, index: number): number {
	const real = variable.real[index];
	if (variable.imag) return Math.hypot(real, variable.imag[index]);
	return real;
}

function bound(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function computeMeasurements(
	definitions: readonly MeasurementDefinition[],
	sources: readonly MeasurementSource[]
): MeasurementOutcome[] {
	return definitions.map((definition) => {
		const signal = definition.signal.trim().toLowerCase();
		const candidates = sources
			.map((source) => ({
				source,
				variable: source.variables.find(
					(candidate) => candidate.name.toLowerCase() === signal
				)
			}))
			.filter(
				(entry): entry is { source: MeasurementSource; variable: AnalogResultVariable } =>
					entry.variable !== undefined
			);
		const hasWindow =
			definition.window?.start !== undefined || definition.window?.stop !== undefined;
		const start = bound(definition.window?.start, Number.NEGATIVE_INFINITY);
		const stop = bound(definition.window?.stop, Number.POSITIVE_INFINITY);

		// Never bind a windowed or series statistic to an axis-less operating
		// point sample: prefer a time/frequency source, and among those the one
		// whose axis overlaps the requested window.
		const axisCandidates = candidates.filter(
			(entry) => axisFor(entry.source.variables) !== undefined
		);
		let chosen: { source: MeasurementSource; variable: AnalogResultVariable } | undefined;
		if (axisCandidates.length > 0) {
			chosen = axisCandidates[0];
			if (hasWindow) {
				const overlapping = axisCandidates.find((entry) => {
					const axis = axisFor(entry.source.variables);
					if (!axis || axis.real.length === 0) return false;
					const first = axis.real[0];
					const last = axis.real[axis.real.length - 1];
					return last >= start && first <= stop;
				});
				if (overlapping) chosen = overlapping;
			}
		} else if (!hasWindow) {
			chosen = candidates[0];
		}

		if (chosen) {
			const { source, variable } = chosen;
			const axis = axisFor(source.variables);
			const values: number[] = [];
			for (let index = 0; index < variable.real.length; index += 1) {
				if (axis) {
					const x = axis.real[index];
					if (x < start || x > stop) continue;
				}
				values.push(magnitudeAt(variable, index));
			}
			if (values.length > 0) {
				if (definition.type === 'minmax') {
					let min = Number.POSITIVE_INFINITY;
					let max = Number.NEGATIVE_INFINITY;
					for (const value of values) {
						if (value < min) min = value;
						if (value > max) max = value;
					}
					return {
						analysisId: definition.id,
						name: definition.name,
						type: definition.type,
						signal: definition.signal,
						status: 'complete' as const,
						min,
						max,
						samples: values.length
					};
				}
				let meanSquare = 0;
				for (const value of values) meanSquare += value * value;
				meanSquare /= values.length;
				return {
					analysisId: definition.id,
					name: definition.name,
					type: definition.type,
					signal: definition.signal,
					status: 'complete' as const,
					value: definition.type === 'rms' ? Math.sqrt(meanSquare) : meanSquare,
					samples: values.length
				};
			}
		}
		return {
			analysisId: definition.id,
			name: definition.name,
			type: definition.type,
			signal: definition.signal,
			status: 'failed' as const,
			diagnostic: unboundMeasurementDiagnostic(definition.name, definition.signal, definition.id)
		};
	});
}

export function measurementValueText(outcome: MeasurementOutcome): string {
	if (outcome.status !== 'complete') return 'no numbers';
	if (outcome.type === 'minmax') {
		return `${formatSI(outcome.min ?? 0)} … ${formatSI(outcome.max ?? 0)}`;
	}
	return formatSI(outcome.value ?? 0);
}
