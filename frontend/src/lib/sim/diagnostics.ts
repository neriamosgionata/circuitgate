export type DiagnosticKind = 'compile-error' | 'oscillation' | 'protocol' | 'analog';

export interface Diagnostic {
	id: string;
	kind: DiagnosticKind;
	message: string;
	code?: string;
	componentIds?: string[];
	nets?: string[];
	analysisId?: string;
	tick?: number;
}

export type DiagnosticsListener = (diagnostics: readonly Diagnostic[]) => void;

export class DiagnosticsStore {
	private diagnostics = new Map<string, Diagnostic>();
	private listeners = new Set<DiagnosticsListener>();

	get size(): number {
		return this.diagnostics.size;
	}

	list(): readonly Diagnostic[] {
		return [...this.diagnostics.values()];
	}

	has(id: string): boolean {
		return this.diagnostics.has(id);
	}

	add(diagnostic: Diagnostic): boolean {
		if (this.diagnostics.has(diagnostic.id)) return false;
		this.diagnostics.set(diagnostic.id, diagnostic);
		this.emit();
		return true;
	}

	dismiss(id: string): boolean {
		if (!this.diagnostics.delete(id)) return false;
		this.emit();
		return true;
	}

	clear(): void {
		if (this.diagnostics.size === 0) return;
		this.diagnostics.clear();
		this.emit();
	}

	subscribe(listener: DiagnosticsListener): () => void {
		this.listeners.add(listener);
		listener(this.list());
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		const snapshot = this.list();
		for (const listener of this.listeners) listener(snapshot);
	}
}
