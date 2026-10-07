import type { Diagnostic } from '../diagnostics';
import type { MeasurementOutcome } from './measurements';
import type { AnalogAnalysisKind, AnalogResultVariable } from './protocol';

/** View-facing result model shared by the analysis panel and the four views. */

export type ResultStatus = 'complete' | 'failed' | 'suppressed';

export interface AnalysisOutcome {
	analysisId: string;
	kind: AnalogAnalysisKind;
	status: ResultStatus;
	stateLabel?: string;
	variables: readonly AnalogResultVariable[];
	durationMs?: number;
	diagnostic?: Diagnostic;
	/** Original point count when the retention cap truncated this result. */
	truncatedFrom?: number | null;
}

export type ResultTab = 'scope' | 'bode' | 'op' | 'meas';

export const RESULT_TABS: readonly { id: ResultTab; label: string }[] = [
	{ id: 'scope', label: 'Scope' },
	{ id: 'bode', label: 'Bode' },
	{ id: 'op', label: 'Operating point' },
	{ id: 'meas', label: 'Measurements' }
];

export function tabForKind(kind: AnalogAnalysisKind): ResultTab | null {
	switch (kind) {
		case 'tran':
			return 'scope';
		case 'ac':
			return 'bode';
		case 'op':
			return 'op';
		default:
			return null;
	}
}

/** Display unit for a result variable, shared by the scope and operating-point views. */
export function signalUnit(variable: AnalogResultVariable | undefined): string {
	if (!variable) return '';
	if (variable.type === 'voltage' || variable.name.startsWith('v(')) return 'V';
	if (variable.type === 'current' || variable.name.startsWith('i(')) return 'A';
	return '';
}

/**
 * Shared measurement-trace palette: biro first, then toner, stamps, ochre,
 * violet, teal, and umber. Scope and Bode draw the same variable in the same
 * ink.
 */
export const TRACE_COLORS: readonly string[] = [
	'#1d4ed8',
	'#1d1d1b',
	'#1f6b43',
	'#c0271b',
	'#8a5a00',
	'#5b3f9e',
	'#00707a',
	'#704214'
];

export type { MeasurementOutcome };
