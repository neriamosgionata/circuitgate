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

export interface CircuitDocument {
	schemaVersion: 1;
	components: Component[];
}
