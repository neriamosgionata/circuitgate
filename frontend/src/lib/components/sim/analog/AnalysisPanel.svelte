<script lang="ts">
	import { onDestroy, untrack } from 'svelte';

	import {
		emitNetlist,
		floatingNodes,
		validateAnalysis,
		type NetlistResult
	} from '../../../engine/analog/netlist';
	import { formatSI, parseSI } from '../../../engine/analog/si';
	import type { AnalogAnalysis, AnalogAnalysisKind } from '../../../model/circuit';
	import {
		analogDiagnostic,
		floatingDiagnostic,
		loadFailureDiagnostic,
		modelProblemDiagnostic,
		noGroundDiagnostic,
		parameterProblemDiagnostic,
		solverDiagnostic,
		unboundMeasurementDiagnostic
	} from '../../../sim/analog/diagnostics';
	import type {
		AnalogEvent,
		AnalogProgressPhase,
		AnalogResultEvent,
		AnalogResultVariable
	} from '../../../sim/analog/protocol';
	import { AnalogWorkerSession, type AnalogWorkerLike } from '../../../sim/analog/session';
	import type { Diagnostic } from '../../../sim/diagnostics';
	import type { CircuitEditorStore, EditorSnapshot } from '../../../state/circuitStore';
	import Diagnostics from '../Diagnostics.svelte';

	interface Props {
		store: CircuitEditorStore;
		readonly?: boolean;
	}

	let { store, readonly = false }: Props = $props();

	type SolverKind = 'op' | 'tran' | 'ac';
	type RunStatus = 'idle' | 'loading' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled';
	type FailedKind = 'load' | 'validation' | 'solve';
	type MeasurementType = 'power' | 'rms' | 'minmax';

	interface AnalysisOutcome {
		analysisId: string;
		kind: AnalogAnalysisKind;
		status: 'complete' | 'failed' | 'suppressed';
		stateLabel?: string;
		variables: AnalogResultVariable[];
		durationMs?: number;
		diagnostic?: Diagnostic;
	}

	interface MeasurementOutcome {
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

	let snapshot = $state<EditorSnapshot>(untrack(() => store.snapshot));
	$effect(() => {
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	let diagnostics = $state<Diagnostic[]>([]);
	let status = $state<RunStatus>('idle');
	let failedKind = $state<FailedKind | null>(null);
	let failedMessage = $state<string | null>(null);
	let progressPhase = $state<AnalogProgressPhase | null>(null);
	let progressAnalysisId = $state<string | null>(null);
	let progressIndeterminate = $state(true);
	let progressFraction = $state<number | undefined>(undefined);
	let progressElapsed = $state(0);
	let committed = $state<AnalysisOutcome[]>([]);
	let measurementOutcomes = $state<MeasurementOutcome[]>([]);
	let runCircuit = $state<EditorSnapshot['circuit'] | null>(null);
	let drafts = $state<Record<string, string>>({});

	let session: AnalogWorkerSession | null = null;
	let commandId = 0;
	let activeCommandId = 0;
	let stage: 'op' | 'solve' | null = null;
	let stageExpected: string[] = [];
	let stageSettled = new Set<string>();
	let collected = new Map<string, AnalysisOutcome>();
	let pendingDecks = new Map<string, { kind: SolverKind; deck: string }>();
	let entryByKind = new Map<SolverKind, AnalogAnalysis>();
	let lastFatal = '';

	const busy = $derived(status === 'loading' || status === 'running');
	const stale = $derived(
		!busy && committed.length > 0 && runCircuit !== null && snapshot.circuit !== runCircuit
	);

	function nextCommandId(): number {
		commandId += 1;
		return commandId;
	}

	const measurements = $derived(snapshot.analyses.filter((entry) => entry.kind === 'meas'));
	function analysisOf(kind: AnalogAnalysisKind): AnalogAnalysis | undefined {
		return snapshot.analyses.find((entry) => entry.kind === kind);
	}

	function paramsOf(kind: AnalogAnalysisKind): Record<string, unknown> {
		return analysisOf(kind)?.params ?? {};
	}

	function solverEntry(kind: SolverKind): AnalogAnalysis {
		return analysisOf(kind) ?? { id: `auto-${kind}`, kind, params: {} };
	}

	function persistParams(kind: AnalogAnalysisKind, params: Record<string, unknown>): void {
		if (readonly) return;
		const existing = analysisOf(kind);
		if (existing) {
			store.updateAnalysis(existing.id, params);
		} else {
			store.addAnalysis(kind, params);
		}
	}

	function draftKey(scope: string, field: string): string {
		return `${scope}:${field}`;
	}

	function numberField(scope: string, field: string, value: unknown): string {
		const raw = drafts[draftKey(scope, field)];
		if (raw !== undefined) return raw;
		return typeof value === 'number' && Number.isFinite(value) ? formatSI(value) : '';
	}

	function commitNumber(
		scope: string,
		kind: AnalogAnalysisKind,
		field: string,
		text: string
	): void {
		if (readonly) return;
		drafts = { ...drafts, [draftKey(scope, field)]: text };
		const parsed = parseSI(text);
		if (!parsed.ok) return;
		persistParams(kind, { ...paramsOf(kind), [field]: parsed.value });
	}

	function clearDraft(scope: string, field: string): void {
		const next = { ...drafts };
		delete next[draftKey(scope, field)];
		drafts = next;
	}

	function sectionProblems(kind: SolverKind): string[] {
		const entry = analysisOf(kind);
		if (!entry) return [];
		return validateAnalysis(entry).map((entry) => entry.message);
	}

	const tranProblems = $derived(sectionProblems('tran'));
	const acProblems = $derived(sectionProblems('ac'));

	const netlistPreview = $derived.by(() => {
		try {
			return emitNetlist(snapshot.circuit, null);
		} catch {
			return null;
		}
	});

	const signalOptions = $derived.by(() => {
		const preview: NetlistResult | null = netlistPreview;
		if (!preview) return [];
		const options: string[] = [];
		for (const entry of preview.nodeMap.nodes) {
			if (entry.node === '0') continue;
			options.push(`v(${entry.node.toLowerCase()})`);
		}
		for (const element of preview.elements) {
			if (element.currentVariable) options.push(element.currentVariable.toLowerCase());
		}
		return options;
	});

	function addDiagnostic(diagnostic: Diagnostic): void {
		if (diagnostics.some((entry) => entry.id === diagnostic.id)) return;
		diagnostics = [...diagnostics, diagnostic];
	}

	function dismissDiagnostic(id: string): void {
		diagnostics = diagnostics.filter((entry) => entry.id !== id);
	}

	function focusComponents(componentIds: readonly string[]): void {
		store.setSelection(componentIds);
	}

	function focusNet(nets: readonly string[]): void {
		if (nets.length === 0) return;
		const owners = snapshot.document.components
			.filter((component) =>
				Object.values(component.inputs).some((net) => nets.includes(net)) ||
				Object.values(component.outputs).some((net) => nets.includes(net))
			)
			.map((component) => component.id);
		if (owners.length > 0) store.setSelection(owners);
	}

	function addMeasurement(): void {
		if (readonly) return;
		const used = new Set(measurements.map((entry) => String(entry.params?.['name'] ?? '')));
		let index = measurements.length + 1;
		let name = `measurement ${index}`;
		while (used.has(name)) {
			index += 1;
			name = `measurement ${index}`;
		}
		store.addAnalysis('meas', {
			name,
			type: 'rms',
			signal: signalOptions[0] ?? ''
		});
	}

	function updateMeasurement(id: string, field: string, value: unknown): void {
		if (readonly) return;
		const entry = snapshot.analyses.find((candidate) => candidate.id === id);
		if (!entry) return;
		store.updateAnalysis(id, { ...(entry.params ?? {}), [field]: value });
	}

	function duplicateMeasurement(id: string): void {
		if (readonly) return;
		store.duplicateAnalysis(id);
	}

	function removeMeasurement(id: string): void {
		if (readonly) return;
		store.removeAnalysis(id);
	}

	function updateMeasurementWindow(
		id: string,
		bound: 'start' | 'stop',
		text: string
	): void {
		if (readonly) return;
		const entry = snapshot.analyses.find((candidate) => candidate.id === id);
		if (!entry) return;
		drafts = { ...drafts, [draftKey(id, bound)]: text };
		const parsed = parseSI(text);
		if (!parsed.ok) return;
		const window =
			typeof entry.params?.['window'] === 'object' && entry.params['window'] !== null
				? { ...(entry.params['window'] as Record<string, unknown>) }
				: {};
		window[bound] = parsed.value;
		store.updateAnalysis(id, { ...(entry.params ?? {}), window });
	}

	function windowValue(id: string, bound: 'start' | 'stop'): string {
		const raw = drafts[draftKey(id, bound)];
		if (raw !== undefined) return raw;
		const entry = snapshot.analyses.find((candidate) => candidate.id === id);
		const window = entry?.params?.['window'];
		if (typeof window !== 'object' || window === null) return '';
		const value = (window as Record<string, unknown>)[bound];
		return typeof value === 'number' && Number.isFinite(value) ? formatSI(value) : '';
	}

	function measurementError(entry: AnalogAnalysis): string | null {
		const name = String(entry.params?.['name'] ?? '').trim();
		if (name.length === 0) return 'measurement name is required';
		const duplicates = measurements.filter(
			(candidate) => String(candidate.params?.['name'] ?? '').trim() === name
		);
		if (duplicates.length > 1) return 'measurement names must be unique';
		const signal = String(entry.params?.['signal'] ?? '');
		if (signal.length === 0) return 'choose a signal target';
		return null;
	}

	function variableFor(
		variables: readonly AnalogResultVariable[],
		signal: string
	): AnalogResultVariable | undefined {
		const target = signal.trim().toLowerCase();
		return variables.find((variable) => variable.name.toLowerCase() === target);
	}

	function axisFor(variables: readonly AnalogResultVariable[]): AnalogResultVariable | undefined {
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

	function computeMeasurements(
		entries: readonly AnalogAnalysis[],
		outcomes: readonly AnalysisOutcome[]
	): MeasurementOutcome[] {
		return entries.map((entry) => {
			const name = String(entry.params?.['name'] ?? '').trim() || entry.id;
			const type = (entry.params?.['type'] ?? 'rms') as MeasurementType;
			const signal = String(entry.params?.['signal'] ?? '');
			const sources = outcomes.filter(
				(outcome) => outcome.status === 'complete' && outcome.variables.length > 0
			);
			for (const source of sources) {
				const variable = variableFor(source.variables, signal);
				if (!variable) continue;
				const axis = axisFor(source.variables);
				const window = entry.params?.['window'];
				const start =
					typeof window === 'object' && window !== null && typeof (window as Record<string, unknown>)['start'] === 'number'
						? ((window as Record<string, unknown>)['start'] as number)
						: Number.NEGATIVE_INFINITY;
				const stop =
					typeof window === 'object' && window !== null && typeof (window as Record<string, unknown>)['stop'] === 'number'
						? ((window as Record<string, unknown>)['stop'] as number)
						: Number.POSITIVE_INFINITY;
				const values: number[] = [];
				for (let index = 0; index < variable.real.length; index++) {
					if (axis) {
						const x = axis.real[index];
						if (x < start || x > stop) continue;
					}
					values.push(magnitudeAt(variable, index));
				}
				if (values.length === 0) continue;
				if (type === 'minmax') {
					return {
						analysisId: entry.id,
						name,
						type,
						signal,
						status: 'complete' as const,
						min: Math.min(...values),
						max: Math.max(...values),
						samples: values.length
					};
				}
				const meanSquare = values.reduce((sum, value) => sum + value * value, 0) / values.length;
				return {
					analysisId: entry.id,
					name,
					type,
					signal,
					status: 'complete' as const,
					value: meanSquare,
					samples: values.length
				};
			}
			const diagnostic = unboundMeasurementDiagnostic(name, signal, entry.id);
			addDiagnostic(diagnostic);
			return {
				analysisId: entry.id,
				name,
				type,
				signal,
				status: 'failed' as const,
				diagnostic
			};
		});
	}

	function finishRun(): void {
		const order = ['op', 'tran', 'ac'];
		const outcomes = [...collected.values()].sort(
			(a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)
		);
		committed = outcomes;
		measurementOutcomes = computeMeasurements(measurements, outcomes);
		runCircuit = snapshot.circuit;
		const solverFailed = outcomes.filter((outcome) => outcome.status !== 'complete').length;
		const measurementFailed = measurementOutcomes.filter(
			(outcome) => outcome.status !== 'complete'
		).length;
		const completeCount = outcomes.filter((outcome) => outcome.status === 'complete').length;
		if (solverFailed + measurementFailed === 0) {
			status = 'complete';
		} else if (completeCount > 0) {
			status = 'partial';
		} else {
			status = 'failed';
			failedKind = failedKind ?? 'solve';
			failedMessage = foundFatalMessage();
		}
		stage = null;
	}

	function foundFatalMessage(): string {
		const failing = diagnostics.find(
			(entry) => entry.code === 'solver' || entry.code === 'load-failure'
		);
		return failing?.message ?? lastFatal ?? 'The run failed.';
	}

	function settle(analysisId: string, outcome: AnalysisOutcome): void {
		if (stageSettled.has(analysisId)) return;
		stageSettled.add(analysisId);
		collected.set(analysisId, outcome);
		if (stageSettled.size < stageExpected.length) return;
		void advanceStage();
	}

	function analyzeResult(event: AnalogResultEvent): AnalysisOutcome {
		const failure = solverDiagnostic(event.analysisId, event.engineDiagnostics);
		if (failure) {
			addDiagnostic(failure);
			return {
				analysisId: event.analysisId,
				kind: event.kind,
				status: 'failed',
				variables: [],
				durationMs: event.durationMs,
				diagnostic: failure
			};
		}
		const stateLabel =
			stage === 'solve' && entryByKind.get('tran')?.id === event.analysisId && stageUsedInitialConditions
				? 'initial conditions'
				: undefined;
		return {
			analysisId: event.analysisId,
			kind: event.kind,
			status: 'complete',
			variables: event.variables,
			durationMs: event.durationMs,
			...(stateLabel === undefined ? {} : { stateLabel })
		};
	}

	let stageUsedInitialConditions = false;

	function advanceStage(): void {
		if (stage === 'op') {
			const opEntry = entryByKind.get('op');
			const opOutcome = opEntry ? collected.get(opEntry.id) : undefined;
			const opSucceeded = opOutcome?.status === 'complete';
			const tranEntry = entryByKind.get('tran');
			const acEntry = entryByKind.get('ac');
			stageExpected = [];
			stageSettled = new Set();
			pendingDecks = new Map();
			stage = 'solve';
			if (tranEntry) {
				const emission = emitNetlist(snapshot.circuit, tranEntry, {
					useInitialConditions: !opSucceeded
				});
				stageUsedInitialConditions = !opSucceeded;
				pendingDecks.set(tranEntry.id, { kind: 'tran', deck: emission.deck });
				stageExpected.push(tranEntry.id);
			}
			if (acEntry) {
				if (opSucceeded) {
					const emission = emitNetlist(snapshot.circuit, acEntry);
					pendingDecks.set(acEntry.id, { kind: 'ac', deck: emission.deck });
					stageExpected.push(acEntry.id);
				} else {
					const diagnostic = analogDiagnostic(
						'solver',
						'AC requires a successful operating point; the operating point failed, so no AC results are produced.',
						{ analysisId: acEntry.id }
					);
					addDiagnostic(diagnostic);
					collected.set(acEntry.id, {
						analysisId: acEntry.id,
						kind: 'ac',
						status: 'suppressed',
						variables: [],
						diagnostic
					});
				}
			}
			if (stageExpected.length === 0) {
				finishRun();
				return;
			}
			sendStage(pendingDecks);
			return;
		}
		if (stage === 'solve') {
			finishRun();
		}
	}

	function sendStage(decks: Map<string, { kind: SolverKind; deck: string }>): void {
		const analyses = [...decks.entries()].map(([id, entry]) => ({
			id,
			kind: entry.kind,
			deck: entry.deck
		}));
		activeCommandId = nextCommandId();
		status = 'loading';
		session?.send({ type: 'run', id: activeCommandId, analyses });
	}

	function handleEvent(event: AnalogEvent): void {
		switch (event.type) {
			case 'progress': {
				if (event.correlationId !== undefined && event.correlationId !== activeCommandId) return;
				progressPhase = event.phase;
				progressAnalysisId = event.analysisId ?? null;
				progressIndeterminate = event.indeterminate;
				progressFraction = event.fraction;
				progressElapsed = event.elapsedMs;
				status = event.phase === 'loading-engine' ? 'loading' : 'running';
				return;
			}
			case 'result': {
				if (event.correlationId !== activeCommandId) return;
				settle(event.analysisId, analyzeResult(event));
				return;
			}
			case 'diagnostic': {
				handleDiagnostic(event.diagnostic);
				return;
			}
			case 'restarted': {
				if (busy) {
					lastFatal = 'the engine worker restarted mid-run';
				}
				return;
			}
			case 'ready':
				return;
		}
	}

	function handleDiagnostic(diagnostic: Diagnostic): void {
		if (diagnostic.code === 'engine-diagnostic') return;
		if (diagnostic.code === 'cancelled') {
			cancelRunState();
			return;
		}
		if (
			diagnostic.code === 'worker-crash' ||
			diagnostic.code === 'worker-timeout' ||
			diagnostic.code === 'out-of-memory'
		) {
			const kind: FailedKind = progressPhase === 'loading-engine' ? 'load' : 'solve';
			failRun(kind, diagnostic.message);
			return;
		}
		const settledFromHost = /^analog:analysis-failed:(?<analysis>[^:]+):/.exec(diagnostic.id);
		if (settledFromHost?.groups?.['analysis']) {
			const analysisId = settledFromHost.groups['analysis'];
			const message = diagnostic.message.startsWith(`${analysisId}: `)
				? diagnostic.message.slice(analysisId.length + 2)
				: diagnostic.message;
			const solver = solverDiagnostic(analysisId, [message]);
			const finalDiagnostic =
				solver ??
				analogDiagnostic('solver', message, {
					analysisId
				});
			addDiagnostic(finalDiagnostic);
			const loadFailure =
				/engine asset fetch failed|engine unavailable|no engine runner|failed to fetch|fetch failed/i.test(
					message
				);
			if (loadFailure) {
				failRun('load', finalDiagnostic.message);
				return;
			}
			let failedKindForEntry: AnalogAnalysisKind = 'op';
			for (const [kind, entry] of entryByKind) {
				if (entry.id === analysisId) failedKindForEntry = kind;
			}
			collected.set(analysisId, {
				analysisId,
				kind: failedKindForEntry,
				status: 'failed',
				variables: [],
				diagnostic: finalDiagnostic
			});
			stageSettled.add(analysisId);
			if (stageSettled.size >= stageExpected.length) void advanceStage();
			return;
		}
		if (diagnostic.kind === 'analog' || diagnostic.code === 'load-failure') {
			addDiagnostic(diagnostic);
		}
	}

	function cancelRunState(): void {
		stage = null;
		stageExpected = [];
		stageSettled = new Set();
		collected = new Map();
		pendingDecks = new Map();
		status = 'cancelled';
		progressPhase = null;
		addDiagnostic(analogDiagnostic('solver', 'run cancelled', { id: 'panel:cancelled' }));
	}

	function failRun(kind: FailedKind, message: string): void {
		stage = null;
		status = 'failed';
		failedKind = kind;
		failedMessage = message;
		if (kind === 'load' && !diagnostics.some((entry) => entry.code === 'load-failure')) {
			addDiagnostic(loadFailureDiagnostic(message));
		}
	}

	function ensureSession(): void {
		if (session) return;
		session = new AnalogWorkerSession({
			createWorker: () =>
				new Worker(new URL('../../../../workers/analog.worker.ts', import.meta.url), {
					type: 'module'
				}) as unknown as AnalogWorkerLike,
			onEvent: handleEvent
		});
	}

	function run(): void {
		if (busy) return;
		const opEntry = solverEntry('op');
		const tranEntry = solverEntry('tran');
		const acEntry = solverEntry('ac');
		entryByKind = new Map<SolverKind, AnalogAnalysis>([
			['op', opEntry],
			['tran', tranEntry],
			['ac', acEntry]
		]);

		const problems = [
			...validateAnalysis(opEntry),
			...validateAnalysis(tranEntry),
			...validateAnalysis(acEntry),
			...measurements.flatMap((entry) => validateAnalysis(entry))
		];
		if (problems.length > 0) {
			for (const entry of problems) {
				addDiagnostic(
					entry.code === 'parameter-cap' || entry.code === 'parameter-invalid'
						? parameterProblemDiagnostic(entry)
						: modelProblemDiagnostic(entry)
				);
			}
			failRun('validation', problems[0].message);
			return;
		}

		const connectivity = floatingNodes(snapshot.circuit);
		if (!connectivity.hasGround) {
			const diagnostic = noGroundDiagnostic(connectivity.floating);
			addDiagnostic(diagnostic);
			failRun('validation', diagnostic.message);
			return;
		}
		if (connectivity.floating.length > 0) {
			for (const net of connectivity.floating) addDiagnostic(floatingDiagnostic(net));
			failRun('validation', `no DC path to ground from ${connectivity.floating[0]}`);
			return;
		}

		for (const entry of entryByKind.values()) {
			const emission = emitNetlist(snapshot.circuit, entry);
			const problemsForEntry = emission.problems.filter(
				(problem) => problem.code !== 'analysis-invalid'
			);
			if (problemsForEntry.length > 0) {
				for (const problem of problemsForEntry) {
					addDiagnostic(
						problem.code === 'model-unresolved' ||
							problem.code === 'model-unsupported' ||
							problem.code === 'unsupported-kind' ||
							problem.code === 'unconnected-pin'
							? modelProblemDiagnostic(problem)
							: parameterProblemDiagnostic(problem)
					);
				}
				failRun('validation', problemsForEntry[0].message);
				return;
			}
		}

		stage = 'op';
		stageExpected = [opEntry.id];
		stageSettled = new Set();
		collected = new Map();
		pendingDecks = new Map();
		lastFatal = '';
		failedKind = null;
		failedMessage = null;
		progressPhase = 'loading-engine';
		progressAnalysisId = opEntry.id;
		progressIndeterminate = true;
		progressFraction = undefined;
		progressElapsed = 0;
		ensureSession();
		const emission = emitNetlist(snapshot.circuit, opEntry);
		pendingDecks.set(opEntry.id, { kind: 'op', deck: emission.deck });
		sendStage(pendingDecks);
	}

	function cancel(): void {
		if (!busy) return;
		session?.send({ type: 'cancel', id: activeCommandId });
		cancelRunState();
	}

	function retry(): void {
		session?.dispose();
		session = null;
		status = 'idle';
		failedKind = null;
		failedMessage = null;
		run();
	}

	function dismissFailure(): void {
		status = 'idle';
		failedKind = null;
		failedMessage = null;
	}

	const statusLabel = $derived(status);

	const progressLabel = $derived.by(() => {
		if (progressPhase === 'loading-engine') return 'Loading engine…';
		if (progressPhase === 'parsing') return 'Parsing results…';
		if (progressPhase === 'solving') {
			return progressAnalysisId ? `Solving ${progressAnalysisId}…` : 'Solving…';
		}
		return 'Working…';
	});

	function resultSummary(outcome: AnalysisOutcome): string {
		if (outcome.kind === 'op') return `${outcome.variables.length} values`;
		const axis = axisFor(outcome.variables);
		const points = axis?.real.length ?? outcome.variables[0]?.real.length ?? 0;
		return `${points} points`;
	}

	function variableRows(outcome: AnalysisOutcome): { name: string; value: string }[] {
		return outcome.variables.slice(0, 24).map((variable) => ({
			name: variable.name,
			value: formatSI(magnitudeAt(variable, 0))
		}));
	}

	function measurementValue(outcome: MeasurementOutcome): string {
		if (outcome.status !== 'complete') return '';
		if (outcome.type === 'minmax') {
			return `${formatSI(outcome.min ?? 0)} … ${formatSI(outcome.max ?? 0)}`;
		}
		return formatSI(outcome.value ?? 0);
	}

	const failedCount = $derived(
		committed.filter((outcome) => outcome.status !== 'complete').length +
			measurementOutcomes.filter((outcome) => outcome.status !== 'complete').length
	);
	const totalCount = $derived(committed.length + measurementOutcomes.length);

	onDestroy(() => {
		session?.dispose();
	});
</script>

<section class="analysis-panel" data-testid="analysis-panel" data-readonly={readonly ? 'true' : 'false'}>
	<div class="bar">
		<span class="title">Analog analyses</span>
		{#if readonly}
			<span class="readonly" data-testid="analysis-readonly">
				Read-only — acquire the edit lock to change analyses.
			</span>
		{/if}
		<button type="button" data-testid="analog-run" onclick={run} disabled={busy}>Run</button>
		{#if busy}
			<button type="button" data-testid="analog-cancel" onclick={cancel}>Cancel</button>
		{/if}
		<span class="status" data-testid="analog-run-status" data-status={status}>{statusLabel}</span>
	</div>

	{#if busy}
		<div
			class="progress"
			data-testid="analog-progress"
			data-phase={progressPhase ?? 'idle'}
			data-indeterminate={progressIndeterminate ? 'true' : 'false'}
		>
			<span class="phase" data-testid="analog-progress-phase">{progressLabel}</span>
			<span class="elapsed">{Math.round(progressElapsed)} ms</span>
			<div class="track">
				<div
					class="fill"
					class:indeterminate={progressIndeterminate}
					style={progressIndeterminate || progressFraction === undefined
						? undefined
						: `width: ${Math.round(progressFraction * 100)}%`}
				></div>
			</div>
		</div>
	{/if}

	{#if status === 'failed'}
		<div class="failed" role="alert" data-testid="analog-failed">
			<span class="failed-message" data-testid="analog-failed-message">{failedMessage ?? 'The run failed.'}</span>
			<button type="button" data-testid="analog-retry" onclick={retry}>Retry</button>
			<button type="button" data-testid="analog-dismiss" onclick={dismissFailure}>Dismiss</button>
		</div>
	{/if}

	{#if status === 'cancelled'}
		<div class="cancelled" role="status" data-testid="analog-cancelled">Run cancelled.</div>
	{/if}

	{#if status === 'partial'}
		<div class="partial" role="status" data-testid="analog-partial">
			Partial run: {failedCount} of {totalCount} analyses failed.
		</div>
	{/if}

	{#if stale}
		<div class="stale" role="status" data-testid="analog-stale">
			<span>Document edited since this run; results are stale.</span>
			<button type="button" data-testid="analog-rerun" onclick={run}>Re-run</button>
		</div>
	{/if}

	<Diagnostics
		{diagnostics}
		onDismiss={dismissDiagnostic}
		onFocus={focusComponents}
		onLocateNet={focusNet}
	/>

	<div class="form">
		<fieldset data-testid="analysis-op-section">
			<legend>Operating point</legend>
			<p class="hint">DC operating point, always run first.</p>
		</fieldset>

		<fieldset data-testid="analysis-tran-section">
			<legend>Transient</legend>
			<label>
				<span>Duration</span>
				<input
					data-testid="analysis-tran-duration"
					value={numberField('tran', 'duration', paramsOf('tran')['duration'] ?? 0.001)}
					disabled={readonly}
					oninput={(event) =>
						commitNumber('tran', 'tran', 'duration', event.currentTarget.value)}
					onblur={() => clearDraft('tran', 'duration')}
				/>
			</label>
			<label>
				<span>Max step</span>
				<input
					data-testid="analysis-tran-maxstep"
					value={numberField('tran', 'maxStep', paramsOf('tran')['maxStep'] ?? 0.000001)}
					disabled={readonly}
					oninput={(event) =>
						commitNumber('tran', 'tran', 'maxStep', event.currentTarget.value)}
					onblur={() => clearDraft('tran', 'maxStep')}
				/>
			</label>
			{#each tranProblems as message (message)}
				<span class="error" data-testid="analysis-error">{message}</span>
			{/each}
		</fieldset>

		<fieldset data-testid="analysis-ac-section">
			<legend>AC sweep</legend>
			<label>
				<span>Start</span>
				<input
					data-testid="analysis-ac-start"
					value={numberField('ac', 'startHz', paramsOf('ac')['startHz'] ?? 10)}
					disabled={readonly}
					oninput={(event) => commitNumber('ac', 'ac', 'startHz', event.currentTarget.value)}
					onblur={() => clearDraft('ac', 'startHz')}
				/>
			</label>
			<label>
				<span>Stop</span>
				<input
					data-testid="analysis-ac-stop"
					value={numberField('ac', 'stopHz', paramsOf('ac')['stopHz'] ?? 1000000)}
					disabled={readonly}
					oninput={(event) => commitNumber('ac', 'ac', 'stopHz', event.currentTarget.value)}
					onblur={() => clearDraft('ac', 'stopHz')}
				/>
			</label>
			<label>
				<span>Points / decade</span>
				<input
					data-testid="analysis-ac-points"
					value={numberField('ac', 'pointsPerDecade', paramsOf('ac')['pointsPerDecade'] ?? 20)}
					disabled={readonly}
					oninput={(event) =>
						commitNumber('ac', 'ac', 'pointsPerDecade', event.currentTarget.value)}
					onblur={() => clearDraft('ac', 'pointsPerDecade')}
				/>
			</label>
			{#each acProblems as message (message)}
				<span class="error" data-testid="analysis-error">{message}</span>
			{/each}
		</fieldset>

		<fieldset class="measurements" data-testid="analysis-meas-section">
			<legend>Measurements</legend>
			<button
				type="button"
				data-testid="measurement-add"
				onclick={addMeasurement}
				disabled={readonly}
			>
				Add measurement
			</button>
			{#each measurements as entry (entry.id)}
				{@const error = measurementError(entry)}
				<div class="measurement" data-testid="measurement-row" data-measurement-id={entry.id}>
					<input
						data-testid="measurement-name"
						aria-label="Measurement name"
						placeholder="name"
						value={String(entry.params?.['name'] ?? '')}
						disabled={readonly}
						oninput={(event) => updateMeasurement(entry.id, 'name', event.currentTarget.value)}
					/>
					<select
						data-testid="measurement-type"
						aria-label="Measurement type"
						value={String(entry.params?.['type'] ?? 'rms')}
						disabled={readonly}
						onchange={(event) => updateMeasurement(entry.id, 'type', event.currentTarget.value)}
					>
						<option value="rms">rms</option>
						<option value="power">power</option>
						<option value="minmax">min/max</option>
					</select>
					<select
						data-testid="measurement-signal"
						aria-label="Measurement signal"
						value={String(entry.params?.['signal'] ?? '')}
						disabled={readonly}
						onchange={(event) => updateMeasurement(entry.id, 'signal', event.currentTarget.value)}
					>
						{#each signalOptions as option (option)}
							<option value={option}>{option}</option>
						{/each}
						{#if String(entry.params?.['signal'] ?? '') !== '' && !signalOptions.includes(String(entry.params?.['signal'] ?? ''))}
							<option value={String(entry.params?.['signal'] ?? '')}>
								{String(entry.params?.['signal'])} (not found)
							</option>
						{/if}
					</select>
					<input
						data-testid="measurement-window-start"
						aria-label="Measurement window start"
						placeholder="window start"
						value={windowValue(entry.id, 'start')}
						disabled={readonly}
						oninput={(event) =>
							updateMeasurementWindow(entry.id, 'start', event.currentTarget.value)}
					/>
					<input
						data-testid="measurement-window-stop"
						aria-label="Measurement window stop"
						placeholder="window stop"
						value={windowValue(entry.id, 'stop')}
						disabled={readonly}
						oninput={(event) =>
							updateMeasurementWindow(entry.id, 'stop', event.currentTarget.value)}
					/>
					<button
						type="button"
						data-testid="measurement-duplicate"
						onclick={() => duplicateMeasurement(entry.id)}
						disabled={readonly}
					>
						Duplicate
					</button>
					<button
						type="button"
						data-testid="measurement-remove"
						onclick={() => removeMeasurement(entry.id)}
						disabled={readonly}
					>
						Remove
					</button>
					{#if error}
						<span class="error" data-testid="measurement-error">{error}</span>
					{/if}
				</div>
			{/each}
		</fieldset>
	</div>

	{#if committed.length > 0}
		<div class="results" data-testid="analog-results">
			{#each committed as outcome (outcome.analysisId)}
				<div
					class="result"
					class:failed={outcome.status !== 'complete'}
					data-testid="analysis-result"
					data-analysis-id={outcome.analysisId}
					data-status={outcome.status}
				>
					<div class="result-head">
						<span class="result-kind">{outcome.kind}</span>
						<span class="result-id">{outcome.analysisId}</span>
						{#if outcome.stateLabel}
							<span class="state" data-testid="analysis-state">{outcome.stateLabel}</span>
						{/if}
						<span class="result-summary">
							{outcome.status === 'complete' ? resultSummary(outcome) : 'no numbers'}
						</span>
					</div>
					{#if outcome.status === 'complete' && outcome.kind === 'op'}
						<div class="values">
							{#each variableRows(outcome) as row (row.name)}
								<span class="value-row"><span>{row.name}</span><span>{row.value}</span></span>
							{/each}
						</div>
					{/if}
					{#if outcome.diagnostic}
						<div class="result-diagnostic" data-testid="analysis-result-diagnostic">
							{outcome.diagnostic.message}
						</div>
					{/if}
				</div>
			{/each}

			{#each measurementOutcomes as outcome (outcome.analysisId)}
				<div
					class="result measurement-result"
					class:failed={outcome.status !== 'complete'}
					data-testid="measurement-result"
					data-analysis-id={outcome.analysisId}
					data-status={outcome.status}
				>
					<div class="result-head">
						<span class="result-kind">{outcome.type}</span>
						<span class="result-id">{outcome.name}</span>
						<span class="result-summary">
							{outcome.status === 'complete' ? measurementValue(outcome) : 'no numbers'}
						</span>
					</div>
					{#if outcome.diagnostic}
						<div class="result-diagnostic" data-testid="analysis-result-diagnostic">
							{outcome.diagnostic.message}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.analysis-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
		min-height: 0;
		overflow: auto;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.title {
		font-weight: 600;
		font-size: 13px;
	}

	.status {
		font-size: 12px;
		color: #546e7a;
	}

	.readonly {
		font-size: 11px;
		color: #b26a00;
	}

	.progress {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #455a64;
	}

	.track {
		flex: 1;
		height: 6px;
		background: #eceff1;
		border-radius: 3px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		width: 30%;
		background: #1565c0;
	}

	.fill.indeterminate {
		animation: slide 1.1s ease-in-out infinite;
	}

	@keyframes slide {
		0% {
			margin-left: -30%;
		}
		100% {
			margin-left: 100%;
		}
	}

	.failed,
	.cancelled,
	.partial,
	.stale {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		font-size: 12px;
		border-radius: 4px;
	}

	.failed {
		background: #ffebee;
		border: 1px solid #ef9a9a;
		color: #b71c1c;
	}

	.cancelled,
	.partial,
	.stale {
		background: #fff8e1;
		border: 1px solid #ffcc80;
		color: #6d4c41;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	fieldset {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 8px;
		border: 1px solid #cfd8dc;
		border-radius: 4px;
		padding: 6px 8px;
	}

	legend {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		color: #607d8b;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11px;
		color: #546e7a;
	}

	input,
	select {
		padding: 4px 6px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 12px;
	}

	.measurement {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		width: 100%;
	}

	.error {
		font-size: 11px;
		color: #c62828;
		width: 100%;
	}

	.hint {
		font-size: 11px;
		color: #90a4ae;
		margin: 0;
	}

	.results {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.result {
		border: 1px solid #cfd8dc;
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
	}

	.result.failed {
		display: block;
		background: #fff8e1;
		border-color: #ffcc80;
		color: #6d4c41;
	}

	.result-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.result-kind {
		font-weight: 700;
		text-transform: uppercase;
		font-size: 10px;
	}

	.result-id {
		color: #607d8b;
	}

	.state {
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 3px;
		padding: 1px 5px;
		font-size: 10px;
		text-transform: uppercase;
	}

	.result-summary {
		margin-left: auto;
		color: #546e7a;
	}

	.values {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin-top: 4px;
	}

	.value-row {
		display: inline-flex;
		gap: 6px;
	}

	.result-diagnostic {
		margin-top: 4px;
		color: #b71c1c;
	}
</style>
