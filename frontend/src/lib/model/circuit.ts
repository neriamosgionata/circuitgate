export type NetId = string;
export type ComponentId = string;

export interface Component {
	id: ComponentId;
	kind: string;
	inputs: Record<string, NetId>;
	outputs: Record<string, NetId>;
	params?: Record<string, unknown>;
	initialState?: unknown;
}

export type Domain = 'logic' | 'analog';

export interface AnalogModel {
	name: string;
	formatVersion: number;
	source: string;
}

export const ANALOG_ANALYSIS_KINDS = ['op', 'tran', 'ac', 'meas'] as const;

export type AnalogAnalysisKind = (typeof ANALOG_ANALYSIS_KINDS)[number];

export interface AnalogAnalysis {
	id: string;
	kind: AnalogAnalysisKind;
	params?: Record<string, unknown>;
}

export interface CircuitDocument {
	schemaVersion: 1;
	components: Component[];
	domain?: Domain;
	models?: AnalogModel[];
	analyses?: AnalogAnalysis[];
}
