import type { Diagnostic } from '../diagnostics';
import type { WorkerLike } from '../session';
import {
	ANALOG_PROTOCOL_VERSION,
	isAnalogEvent,
	type AnalogAnalysisRequest,
	type AnalogCommand,
	type AnalogDiagnosticCode,
	type AnalogEvent,
	type AnalogInitializeCommand,
	type AnalogProgressEvent,
	type AnalogProgressPhase,
	type AnalogResultEvent,
	type AnalogResultVariable,
	type AnalogRunCommand
} from './protocol';

/**
 * Analog session layer: the worker-side `AnalogHost` that owns the transport
 * state machine, and the main-thread `AnalogWorkerSession` that spawns the
 * worker, watches it, and retains completed results (KTD2, KTD9).
 */

export class AnalogResultsStore {
	private results = new Map<string, AnalogResultEvent>();

	get size(): number {
		return this.results.size;
	}

	add(result: AnalogResultEvent): void {
		this.results.set(result.analysisId, result);
	}

	get(analysisId: string): AnalogResultEvent | undefined {
		return this.results.get(analysisId);
	}

	list(): readonly AnalogResultEvent[] {
		return [...this.results.values()];
	}

	clear(): void {
		this.results.clear();
	}
}

interface CoalescerOptions {
	now: () => number;
	schedule: (callback: () => void) => () => void;
	intervalMs: number;
}

/** Leading-edge throttle with a trailing flush, so the newest update survives. */
class ProgressCoalescer {
	private lastEmit = Number.NEGATIVE_INFINITY;
	private pending: AnalogProgressEvent | null = null;
	private cancelFlush: (() => void) | null = null;

	constructor(
		private readonly emit: (event: AnalogProgressEvent) => void,
		private readonly options: CoalescerOptions
	) {}

	push(event: AnalogProgressEvent): void {
		const now = this.options.now();
		if (now - this.lastEmit >= this.options.intervalMs) {
			this.cancelFlush?.();
			this.cancelFlush = null;
			this.pending = null;
			this.lastEmit = now;
			this.emit(event);
			return;
		}
		this.pending = event;
		if (!this.cancelFlush) {
			this.cancelFlush = this.options.schedule(() => {
				this.cancelFlush = null;
				this.flush();
			});
		}
	}

	flush(): void {
		const pending = this.pending;
		this.pending = null;
		if (!pending) return;
		this.lastEmit = this.options.now();
		this.emit(pending);
	}

	cancel(): void {
		this.cancelFlush?.();
		this.cancelFlush = null;
		this.pending = null;
	}
}

export interface AnalogProgressUpdate {
	phase: AnalogProgressPhase;
	analysisId?: string;
	fraction?: number;
}

export interface AnalogAnalysisOutcome {
	variables: AnalogResultVariable[];
	engineDiagnostics?: string[];
	durationMs?: number;
}

export type AnalogRunner = (
	analysis: AnalogAnalysisRequest,
	report: (update: AnalogProgressUpdate) => void
) => Promise<AnalogAnalysisOutcome>;

export interface AnalogHostOptions {
	now?: () => number;
	schedule?: (callback: () => void) => () => void;
	progressIntervalMs?: number;
}

/**
 * Worker-side protocol state machine. It never touches the engine itself:
 * the injected `runner` owns engine loading inside the run path, so
 * `initialize` stays engine-free (KTD9).
 */
export class AnalogHost {
	private readonly emitEvent: (event: AnalogEvent, transfer?: Transferable[]) => void;
	private runner: AnalogRunner | null;
	private readonly now: () => number;
	private readonly progress: ProgressCoalescer;

	private initialized = false;
	private disposed = false;
	private running = false;
	private cancelled = false;
	private currentRunId: number | null = null;
	private runStartedAt = 0;
	private diagnosticSequence = 0;

	constructor(
		emit: (event: AnalogEvent, transfer?: Transferable[]) => void,
		runner: AnalogRunner | null,
		options: AnalogHostOptions = {}
	) {
		this.emitEvent = emit;
		this.runner = runner;
		this.now = options.now ?? (() => Date.now());
		const intervalMs = options.progressIntervalMs ?? 100;
		const schedule =
			options.schedule ??
			((callback: () => void) => {
				const handle = setTimeout(callback, intervalMs);
				return () => clearTimeout(handle);
			});
		this.progress = new ProgressCoalescer((event) => this.emitEvent(event), {
			now: this.now,
			schedule,
			intervalMs
		});
	}

	handle(command: AnalogCommand): void {
		if (this.disposed) return;
		switch (command.type) {
			case 'initialize':
				this.initialize(command);
				return;
			case 'run':
				void this.run(command);
				return;
			case 'cancel':
				this.cancelled = true;
				return;
			case 'dispose':
				this.dispose();
				return;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.initialized = false;
		this.cancelled = true;
		this.runner = null;
		this.progress.cancel();
	}

	private initialize(command: AnalogInitializeCommand): void {
		this.initialized = false;
		if (command.protocolVersion !== ANALOG_PROTOCOL_VERSION) {
			this.emitDiagnostic({
				id: `analog:protocol:${command.id}`,
				kind: 'protocol',
				code: 'unsupported-protocol',
				message: `unsupported protocol version ${String(command.protocolVersion)}; expected ${ANALOG_PROTOCOL_VERSION}`
			});
			return;
		}
		this.initialized = true;
		this.emitEvent({ type: 'ready', correlationId: command.id });
	}

	private async run(command: AnalogRunCommand): Promise<void> {
		if (this.disposed) return;
		if (!this.initialized) {
			this.emitDiagnostic(this.issue(`analog:not-initialized:${command.id}`, 'not-initialized', 'run before initialize'));
			return;
		}
		if (this.running) {
			this.emitDiagnostic(this.issue(`analog:run-in-progress:${command.id}`, 'run-in-progress', 'a run is already active'));
			return;
		}
		if (!this.runner) {
			this.emitDiagnostic(this.issue(`analog:engine-unavailable:${command.id}`, 'engine-unavailable', 'no engine runner is attached'));
			return;
		}

		this.running = true;
		this.cancelled = false;
		this.currentRunId = command.id;
		this.runStartedAt = this.now();
		try {
			for (const analysis of command.analyses) {
				if (this.cancelled || this.disposed) return;
				this.reportProgress({ phase: 'loading-engine', analysisId: analysis.id });

				let outcome: AnalogAnalysisOutcome;
				try {
					outcome = await this.runner(analysis, (update) => {
						this.reportProgress({ ...update, analysisId: update.analysisId ?? analysis.id });
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.emitDiagnostic(
						this.issue(`analog:analysis-failed:${analysis.id}:${command.id}`, 'analysis-failed', `${analysis.id}: ${message}`, analysis.id)
					);
					continue;
				}
				if (this.cancelled || this.disposed) return;

				for (const line of outcome.engineDiagnostics ?? []) {
					this.emitDiagnostic(this.issue(`analog:engine:${this.diagnosticSequence++}`, 'engine-diagnostic', line));
				}

				const transfer: Transferable[] = [];
				for (const variable of outcome.variables) {
					transfer.push(variable.real.buffer);
					if (variable.imag) transfer.push(variable.imag.buffer);
				}
				this.emitEvent(
					{
						type: 'result',
						correlationId: command.id,
						analysisId: analysis.id,
						kind: analysis.kind,
						variables: outcome.variables,
						engineDiagnostics: outcome.engineDiagnostics ?? [],
						durationMs: outcome.durationMs ?? 0
					},
					transfer
				);
			}
		} finally {
			this.running = false;
			this.currentRunId = null;
			this.progress.cancel();
		}
	}

	private reportProgress(update: AnalogProgressUpdate): void {
		if (this.cancelled || this.disposed || this.currentRunId === null) return;
		const event: AnalogProgressEvent = {
			type: 'progress',
			correlationId: this.currentRunId,
			phase: update.phase,
			elapsedMs: this.now() - this.runStartedAt,
			indeterminate: update.fraction === undefined
		};
		if (update.analysisId !== undefined) event.analysisId = update.analysisId;
		if (update.fraction !== undefined) event.fraction = update.fraction;
		this.progress.push(event);
	}

	private emitDiagnostic(diagnostic: Diagnostic): void {
		this.emitEvent({ type: 'diagnostic', diagnostic });
	}

	private issue(id: string, code: AnalogDiagnosticCode, message: string, analysisId?: string): Diagnostic {
		return {
			id,
			kind: 'protocol',
			code,
			message,
			...(analysisId === undefined ? {} : { analysisId })
		};
	}
}

export interface AnalogWorkerLike extends WorkerLike {
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

export interface AnalogWorkerSessionOptions {
	createWorker: () => AnalogWorkerLike;
	onEvent: (event: AnalogEvent) => void;
	results?: AnalogResultsStore;
	/** Progress delivery cap; default 100 ms (10 Hz). */
	progressIntervalMs?: number;
	/** No-progress deadline; default 30 s, comfortably above the 10 s cold run. */
	watchdogTimeoutMs?: number;
	now?: () => number;
	schedule?: (callback: () => void) => () => void;
}

export class AnalogWorkerSession {
	readonly results: AnalogResultsStore;
	private readonly options: AnalogWorkerSessionOptions;
	private readonly now: () => number;
	private readonly schedule: (callback: () => void) => () => void;
	private readonly watchdogTimeoutMs: number;
	private readonly progress: ProgressCoalescer;

	private worker: AnalogWorkerLike;
	private commandId = 0;
	private isDisposed = false;
	private restartCount = 0;
	private watchdogRunId: number | null = null;
	private watchdogLastProgressAt = 0;
	private watchdogPending = 0;
	private watchdogTimer: (() => void) | null = null;

	constructor(options: AnalogWorkerSessionOptions) {
		this.options = options;
		this.results = options.results ?? new AnalogResultsStore();
		this.now = options.now ?? (() => Date.now());
		this.watchdogTimeoutMs = options.watchdogTimeoutMs ?? 30_000;
		this.schedule =
			options.schedule ??
			((callback: () => void) => {
				const handle = setTimeout(callback, this.watchdogTimeoutMs);
				return () => clearTimeout(handle);
			});
		this.progress = new ProgressCoalescer((event) => this.options.onEvent(event), {
			now: this.now,
			schedule: options.schedule ?? ((callback: () => void) => {
				const handle = setTimeout(callback, options.progressIntervalMs ?? 100);
				return () => clearTimeout(handle);
			}),
			intervalMs: options.progressIntervalMs ?? 100
		});
		this.worker = this.spawn();
	}

	get disposed(): boolean {
		return this.isDisposed;
	}

	dispose(): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		this.cancelWatchdog();
		this.progress.cancel();
		this.worker.terminate();
	}

	send(command: AnalogCommand): void {
		if (this.isDisposed) return;
		switch (command.type) {
			case 'initialize':
				this.worker.postMessage(command);
				return;
			case 'run':
				this.worker.postMessage(command);
				this.watchdogPending = command.analyses.length;
				this.armWatchdog(command.id);
				return;
			case 'cancel':
				this.cancelRun(command.id);
				return;
			case 'dispose':
				this.dispose();
				return;
		}
	}

	private spawn(): AnalogWorkerLike {
		const worker = this.options.createWorker();
		worker.addEventListener('message', (event) => {
			if (this.isDisposed || worker !== this.worker) return;
			const data = (event as { data?: unknown }).data;
			if (isAnalogEvent(data)) this.receive(data);
		});
		worker.addEventListener('error', (event) => {
			if (this.isDisposed || worker !== this.worker) return;
			const message = (event as { message?: string }).message ?? 'worker error';
			const code: AnalogDiagnosticCode = /out of memory|oom|RangeError/i.test(message)
				? 'out-of-memory'
				: 'worker-crash';
			this.respawn(message, code);
		});
		worker.addEventListener('messageerror', () => {
			if (this.isDisposed || worker !== this.worker) return;
			this.respawn('message deserialization error', 'worker-crash');
		});
		const initialize: AnalogInitializeCommand = {
			type: 'initialize',
			id: ++this.commandId,
			protocolVersion: ANALOG_PROTOCOL_VERSION
		};
		worker.postMessage(initialize);
		return worker;
	}

	private receive(event: AnalogEvent): void {
		switch (event.type) {
			case 'progress':
				if (this.watchdogRunId !== null) {
					this.watchdogLastProgressAt = this.now();
					this.cancelWatchdogTimer();
					this.watchdogTimer = this.schedule(() => this.watchdogTick());
				}
				this.progress.push(event);
				return;
			case 'result':
				if (event.correlationId === this.watchdogRunId) {
					// One run command carries several analyses; the watchdog stays
					// armed until the last of them settles.
					this.watchdogPending = Math.max(0, this.watchdogPending - 1);
					if (this.watchdogPending === 0) {
						this.cancelWatchdog();
					} else {
						this.watchdogLastProgressAt = this.now();
						this.cancelWatchdogTimer();
						this.watchdogTimer = this.schedule(() => this.watchdogTick());
					}
				}
				this.results.add(event);
				this.options.onEvent(event);
				return;
			case 'diagnostic':
				if (
					event.diagnostic.code === 'analysis-failed' &&
					this.watchdogRunId !== null &&
					this.watchdogPending > 0
				) {
					this.watchdogPending -= 1;
					if (this.watchdogPending === 0) this.cancelWatchdog();
				}
				this.options.onEvent(event);
				return;
			default:
				this.options.onEvent(event);
		}
	}

	private respawn(reason: string, code: AnalogDiagnosticCode): void {
		const previous = this.worker;
		previous.terminate();
		this.cancelWatchdog();
		this.progress.cancel();
		this.worker = this.spawn();
		this.options.onEvent({ type: 'restarted', reason });
		this.options.onEvent({
			type: 'diagnostic',
			diagnostic: {
				id: `analog:${code}:${this.restartCount++}`,
				kind: 'protocol',
				code,
				message: reason
			}
		});
	}

	private cancelRun(commandId: number): void {
		const wasRunning = this.watchdogRunId !== null;
		this.worker.postMessage({ type: 'cancel', id: commandId });
		this.worker.terminate();
		this.cancelWatchdog();
		this.progress.cancel();
		this.worker = this.spawn();
		if (wasRunning) {
			this.options.onEvent({
				type: 'diagnostic',
				diagnostic: {
					id: `analog:cancelled:${commandId}`,
					kind: 'protocol',
					code: 'cancelled',
					message: 'run cancelled'
				}
			});
		}
	}

	private armWatchdog(runId: number): void {
		this.cancelWatchdogTimer();
		this.watchdogRunId = runId;
		this.watchdogLastProgressAt = this.now();
		this.watchdogTimer = this.schedule(() => this.watchdogTick());
	}

	private watchdogTick(): void {
		this.watchdogTimer = null;
		if (this.isDisposed || this.watchdogRunId === null) return;
		const elapsed = this.now() - this.watchdogLastProgressAt;
		if (elapsed >= this.watchdogTimeoutMs) {
			const stalledRun = this.watchdogRunId;
			this.watchdogRunId = null;
			this.respawn(
				`no progress for ${Math.round(elapsed)} ms during run ${stalledRun}`,
				'worker-timeout'
			);
			return;
		}
		this.watchdogTimer = this.schedule(() => this.watchdogTick());
	}

	private cancelWatchdog(): void {
		this.watchdogRunId = null;
		this.cancelWatchdogTimer();
	}

	private cancelWatchdogTimer(): void {
		this.watchdogTimer?.();
		this.watchdogTimer = null;
	}
}
