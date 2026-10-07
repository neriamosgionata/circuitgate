import { ANALOG_ANALYSIS_KINDS, type AnalogAnalysisKind, type AnalogModel } from '../../model/circuit';
import type { Diagnostic } from '../diagnostics';

/**
 * Analog transport protocol. It copies the digital conventions — finite
 * monotonic command ids, correlation ids on responses, unsolicited
 * progress/diagnostic events, and a strict version check on initialize —
 * but carries SPICE analysis requests and typed-array results (KTD2, KTD9).
 */

export const ANALOG_PROTOCOL_VERSION = 1;

export type { AnalogAnalysisKind };

export interface AnalogAnalysisRequest {
	/** Stable analysis id echoed on every progress and result event. */
	id: string;
	kind: AnalogAnalysisKind;
	/** Netlist emitted by the front end; the worker re-validates it on every run. */
	deck: string;
	/**
	 * Stored model sources carried alongside the deck so the worker repeats
	 * the parse and every cap before engine handoff (KTD6); a hand-crafted
	 * project document cannot skip import-time validation.
	 */
	models?: AnalogModel[];
	/** Variable names to return; all variables when omitted. */
	variables?: string[];
}

export interface AnalogInitializeCommand {
	type: 'initialize';
	id: number;
	protocolVersion: number;
}

export interface AnalogRunCommand {
	type: 'run';
	id: number;
	analyses: AnalogAnalysisRequest[];
}

export interface AnalogCancelCommand {
	type: 'cancel';
	id: number;
}

export interface AnalogDisposeCommand {
	type: 'dispose';
	id: number;
}

export type AnalogCommand =
	| AnalogInitializeCommand
	| AnalogRunCommand
	| AnalogCancelCommand
	| AnalogDisposeCommand;


export interface AnalogReadyEvent {
	type: 'ready';
	correlationId: number;
}

export type AnalogProgressPhase = 'loading-engine' | 'solving' | 'parsing';

export interface AnalogProgressEvent {
	type: 'progress';
	/** Run command this progress belongs to; absent before a run starts. */
	correlationId?: number;
	analysisId?: string;
	phase: AnalogProgressPhase;
	elapsedMs: number;
	/** True while the engine exposes no incremental progress (U1: no callbacks). */
	indeterminate: boolean;
	fraction?: number;
}

export interface AnalogResultVariable {
	name: string;
	/** Rawfile variable type, for example `time`, `frequency`, or `voltage`. */
	type: string;
	real: Float64Array;
	imag?: Float64Array;
}

export interface AnalogResultEvent {
	type: 'result';
	correlationId: number;
	analysisId: string;
	kind: AnalogAnalysisKind;
	variables: AnalogResultVariable[];
	/** Engine stderr lines, already filtered of platform noise. */
	engineDiagnostics: string[];
	durationMs: number;
}

export interface AnalogDiagnosticEvent {
	type: 'diagnostic';
	diagnostic: Diagnostic;
}

export interface AnalogRestartedEvent {
	type: 'restarted';
	reason: string;
}

export type AnalogEvent =
	| AnalogReadyEvent
	| AnalogProgressEvent
	| AnalogResultEvent
	| AnalogDiagnosticEvent
	| AnalogRestartedEvent;


export type AnalogDiagnosticCode =
	| 'unsupported-protocol'
	| 'not-initialized'
	| 'run-in-progress'
	| 'engine-unavailable'
	| 'analysis-failed'
	| 'engine-diagnostic'
	| 'cancelled'
	| 'worker-crash'
	| 'worker-timeout'
	| 'out-of-memory';

const COMMAND_TYPES: ReadonlySet<string> = new Set(['initialize', 'run', 'cancel', 'dispose']);

const EVENT_TYPES: ReadonlySet<string> = new Set([
	'ready',
	'progress',
	'result',
	'diagnostic',
	'restarted'
]);

const PROGRESS_PHASES: ReadonlySet<string> = new Set(['loading-engine', 'solving', 'parsing']);

const ANALYSIS_KINDS: ReadonlySet<string> = new Set(ANALOG_ANALYSIS_KINDS);

export function isAnalogCommand(value: unknown): value is AnalogCommand {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { type?: unknown; id?: unknown };
	return (
		typeof candidate.type === 'string' &&
		COMMAND_TYPES.has(candidate.type) &&
		typeof candidate.id === 'number' &&
		Number.isFinite(candidate.id)
	);
}

export function isAnalogEvent(value: unknown): value is AnalogEvent {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { type?: unknown };
	if (typeof candidate.type !== 'string' || !EVENT_TYPES.has(candidate.type)) return false;
	if (candidate.type === 'result') return isAnalogResultEvent(candidate);
	if (candidate.type === 'progress') return isAnalogProgressEvent(candidate);
	return true;
}

function isAnalogResultEvent(value: object): value is AnalogResultEvent {
	const candidate = value as {
		correlationId?: unknown;
		analysisId?: unknown;
		kind?: unknown;
		variables?: unknown;
		engineDiagnostics?: unknown;
		durationMs?: unknown;
	};
	return (
		typeof candidate.correlationId === 'number' &&
		Number.isFinite(candidate.correlationId) &&
		typeof candidate.analysisId === 'string' &&
		typeof candidate.kind === 'string' &&
		ANALYSIS_KINDS.has(candidate.kind) &&
		Array.isArray(candidate.variables) &&
		candidate.variables.every(isAnalogResultVariable) &&
		Array.isArray(candidate.engineDiagnostics) &&
		candidate.engineDiagnostics.every((line) => typeof line === 'string') &&
		typeof candidate.durationMs === 'number' &&
		Number.isFinite(candidate.durationMs)
	);
}

function isAnalogResultVariable(value: unknown): value is AnalogResultVariable {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { name?: unknown; type?: unknown; real?: unknown; imag?: unknown };
	return (
		typeof candidate.name === 'string' &&
		typeof candidate.type === 'string' &&
		candidate.real instanceof Float64Array &&
		(candidate.imag === undefined || candidate.imag instanceof Float64Array)
	);
}

function isAnalogProgressEvent(value: object): value is AnalogProgressEvent {
	const candidate = value as {
		phase?: unknown;
		elapsedMs?: unknown;
		indeterminate?: unknown;
		correlationId?: unknown;
		fraction?: unknown;
	};
	return (
		typeof candidate.phase === 'string' &&
		PROGRESS_PHASES.has(candidate.phase) &&
		typeof candidate.elapsedMs === 'number' &&
		Number.isFinite(candidate.elapsedMs) &&
		typeof candidate.indeterminate === 'boolean' &&
		(candidate.correlationId === undefined ||
			(typeof candidate.correlationId === 'number' && Number.isFinite(candidate.correlationId))) &&
		(candidate.fraction === undefined ||
			(typeof candidate.fraction === 'number' && Number.isFinite(candidate.fraction)))
	);
}
