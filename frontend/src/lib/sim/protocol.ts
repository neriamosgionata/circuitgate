import type { SubcircuitDefinitions } from '../engine/hierarchy';
import type { LogicValue } from '../engine/values';
import type { CircuitDocument } from '../model/circuit';
import type { Diagnostic } from './diagnostics';
import type { WaveformChange } from './recorder';

export const PROTOCOL_VERSION = 1;

export type SimulationMode = 'delta' | 'timed';
export type SimulationStatus = 'stable' | 'oscillation';

export interface InitCommand {
	type: 'init';
	id: number;
	protocolVersion?: number;
	document: CircuitDocument;
	definitions?: SubcircuitDefinitions;
	mode?: SimulationMode;
	initialValues?: Readonly<Record<string, LogicValue>>;
}

export interface ToggleCommand {
	type: 'toggle';
	id: number;
	componentId: string;
}

export interface SetInputCommand {
	type: 'setInput';
	id: number;
	componentId: string;
	value: LogicValue;
}

export interface StepCommand {
	type: 'step';
	id: number;
	ticks?: number;
}

export interface RunCommand {
	type: 'run';
	id: number;
}

export interface PauseCommand {
	type: 'pause';
	id: number;
}

export interface ResetCommand {
	type: 'reset';
	id: number;
}

export interface SetModeCommand {
	type: 'setMode';
	id: number;
	mode: SimulationMode;
}

export interface HistoryCommand {
	type: 'history';
	id: number;
}

export type SimulationCommand =
	| InitCommand
	| ToggleCommand
	| SetInputCommand
	| StepCommand
	| RunCommand
	| PauseCommand
	| ResetCommand
	| SetModeCommand
	| HistoryCommand;

export type SimulationCommandType = SimulationCommand['type'];

export interface ComponentInfo {
	id: string;
	kind: string;
}

export interface NetChange {
	net: string;
	value: LogicValue;
	oscillating: boolean;
	tick: number;
}

export interface CompileIssue {
	code: string;
	message: string;
	componentIds?: string[];
	path?: string;
}

export interface ReadyEvent {
	type: 'ready';
	correlationId: number;
	mode: SimulationMode;
	nets: string[];
	components: ComponentInfo[];
}

export interface AckEvent {
	type: 'ack';
	correlationId: number;
	command: SimulationCommandType;
}

export interface StatusEvent {
	type: 'status';
	running: boolean;
	mode: SimulationMode;
	tick: number;
}

export interface ValuesEvent {
	type: 'values';
	frame: number;
	tick: number;
	status: SimulationStatus;
	changes: NetChange[];
}

export interface CompileErrorEvent {
	type: 'compileError';
	correlationId: number;
	issues: CompileIssue[];
}

export interface HistoryEvent {
	type: 'history';
	correlationId: number;
	nets: Record<string, WaveformChange[]>;
}

export interface DiagnosticEvent {
	type: 'diagnostic';
	diagnostic: Diagnostic;
}

export interface RestartedEvent {
	type: 'restarted';
	reason: string;
}

export type SimulationEvent =
	| ReadyEvent
	| AckEvent
	| StatusEvent
	| ValuesEvent
	| CompileErrorEvent
	| HistoryEvent
	| DiagnosticEvent
	| RestartedEvent;

const COMMAND_TYPES: ReadonlySet<string> = new Set([
	'init',
	'toggle',
	'setInput',
	'step',
	'run',
	'pause',
	'reset',
	'setMode',
	'history'
]);

const EVENT_TYPES: ReadonlySet<string> = new Set([
	'ready',
	'ack',
	'status',
	'values',
	'compileError',
	'history',
	'diagnostic',
	'restarted'
]);

export function isSimulationCommand(value: unknown): value is SimulationCommand {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { type?: unknown; id?: unknown };
	return (
		typeof candidate.type === 'string' &&
		COMMAND_TYPES.has(candidate.type) &&
		typeof candidate.id === 'number' &&
		Number.isFinite(candidate.id)
	);
}

export function isSimulationEvent(value: unknown): value is SimulationEvent {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { type?: unknown };
	return typeof candidate.type === 'string' && EVENT_TYPES.has(candidate.type);
}
