<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { SubcircuitDefinitions } from '../../engine/hierarchy';
	import type { LogicValue } from '../../engine/values';
	import type { CircuitDocument, Component } from '../../model/circuit';
	import { DiagnosticsStore, type Diagnostic } from '../../sim/diagnostics';
	import {
		type SimulationEvent,
		type SimulationMode,
		type SimulationPauseReason
	} from '../../sim/protocol';
	import { WaveformRecorder } from '../../sim/recorder';
	import { WorkerSimulationSession, type WorkerLike } from '../../sim/session';
	import type { CircuitEditorStore, EditorSnapshot } from '../../state/circuitStore';
	import WaveformViewer from '../waveform/WaveformViewer.svelte';
	import Controls from './Controls.svelte';
	import Diagnostics from './Diagnostics.svelte';
	import Probe from './Probe.svelte';

	interface Props {
		store: CircuitEditorStore;
		mode: SimulationMode;
		onModeChange: (mode: SimulationMode) => void;
	}

	let { store, mode, onModeChange }: Props = $props();

	let snapshot = $state<EditorSnapshot>(untrack(() => store.snapshot));
	$effect(() => {
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	const diagnostics = new DiagnosticsStore();
	let diagnosticList = $state<readonly Diagnostic[]>([]);
	$effect(() => {
		return diagnostics.subscribe((list) => {
			diagnosticList = list;
		});
	});

	const mirror = new WaveformRecorder();
	let version = $state(0);
	let nets = $state<string[]>([]);
	let running = $state(false);
	let tick = $state(0);
	let ready = $state(false);
	let pauseReason = $state<SimulationPauseReason | null>(null);
	let session: WorkerSimulationSession | null = null;
	let commandId = 0;

	function nextId(): number {
		commandId += 1;
		return commandId;
	}

	function handleEvent(event: SimulationEvent) {
		switch (event.type) {
			case 'ready':
				nets = event.nets;
				ready = true;
				break;
			case 'status':
				running = event.running;
				tick = event.tick;
				pauseReason = event.pauseReason ?? null;
				break;
			case 'values':
				for (const change of event.changes) {
					mirror.record(change.tick, change.net, change.value, change.oscillating);
				}
				if (event.changes.length > 0) {
					store.applyNetValues(event.changes);
					version += 1;
				}
				tick = event.tick;
				break;
			case 'compileError':
				ready = false;
				running = false;
				for (const issue of event.issues) {
					diagnostics.add({
						id: `compile:${issue.code}:${issue.message}`,
						kind: 'compile-error',
						message: issue.message,
						code: issue.code,
						componentIds: issue.componentIds
					});
				}
				break;
			case 'diagnostic':
				if (event.cleared) {
					diagnostics.dismiss(event.diagnostic.id);
				} else if (event.diagnostic.kind === 'timing') {
					diagnostics.upsert(event.diagnostic);
				} else {
					diagnostics.add(event.diagnostic);
				}
				break;
			case 'restarted':
				mirror.clear();
				store.clearNetValues();
				diagnostics.clear();
				nets = [];
				ready = false;
				running = false;
				tick = 0;
				pauseReason = null;
				version += 1;
				break;
			case 'ack':
			case 'history':
				break;
		}
	}

	function startSession(
		document: CircuitDocument,
		definitions: SubcircuitDefinitions,
		nextMode: SimulationMode
	) {
		session?.dispose();
		mirror.clear();
		diagnostics.clear();
		nets = [];
		ready = false;
		running = false;
		tick = 0;
		pauseReason = null;
		version += 1;
		store.clearNetValues();
		session = new WorkerSimulationSession({
			createWorker: () =>
				new Worker(new URL('../../../workers/engine.worker.ts', import.meta.url), {
					type: 'module'
				}) as unknown as WorkerLike,
			// The worker boundary only accepts structured-cloneable data, so
			// strip Svelte's reactive proxies before posting the init command.
			document: $state.snapshot(document),
			definitions: $state.snapshot(definitions),
			mode: nextMode,
			onEvent: handleEvent
		});
	}

	onMount(() => {
		startSession(snapshot.circuit, snapshot.definitions, mode);
		return () => session?.dispose();
	});

	let lastCircuit: CircuitDocument | null = untrack(() => store.snapshot.circuit);
	let lastDefinitions: SubcircuitDefinitions | null = untrack(() => store.snapshot.definitions);
	$effect(() => {
		// Re-runs on every store emission; the raw references behind the
		// reactive snapshot only change when the document actually changes.
		void snapshot;
		const current = store.snapshot;
		if (current.circuit === lastCircuit && current.definitions === lastDefinitions) return;
		lastCircuit = current.circuit;
		lastDefinitions = current.definitions;
		if (session) startSession(current.circuit, current.definitions, mode);
	});

	function run() {
		session?.send({ type: 'run', id: nextId() });
	}

	function pause() {
		session?.send({ type: 'pause', id: nextId() });
	}

	function step() {
		session?.send({ type: 'step', id: nextId(), ticks: 1 });
	}

	function reset() {
		mirror.clear();
		diagnostics.clear();
		pauseReason = null;
		version += 1;
		store.clearNetValues();
		session?.send({ type: 'reset', id: nextId() });
	}

	function changeMode(next: SimulationMode) {
		onModeChange(next);
		mirror.clear();
		diagnostics.clear();
		pauseReason = null;
		version += 1;
		store.clearNetValues();
		session?.send({ type: 'setMode', id: nextId(), mode: next });
	}

	function toggleSwitch(componentId: string) {
		session?.send({ type: 'toggle', id: nextId(), componentId });
	}

	const ioComponents = $derived(
		snapshot.document.components.filter(
			(component) =>
				component.kind === 'switch' || component.kind === 'probe' || component.kind === 'led'
		)
	);

	const hasClock = $derived(
		snapshot.document.components.some((component) => component.kind === 'clock')
	);

	const selectedNets = $derived.by(() => {
		const selected = new Set<string>();
		for (const component of snapshot.document.components) {
			if (!snapshot.selection.has(component.id)) continue;
			for (const net of Object.values(component.inputs)) selected.add(net);
			for (const net of Object.values(component.outputs)) selected.add(net);
		}
		return selected;
	});

	function signalNet(component: Component): string | undefined {
		return component.kind === 'switch' ? component.outputs['out'] : component.inputs['in'];
	}

	function signalValue(component: Component): LogicValue | undefined {
		const net = signalNet(component);
		return net === undefined ? undefined : snapshot.netValues[net];
	}

	function signalOscillating(component: Component): boolean {
		const net = signalNet(component);
		return net === undefined ? false : snapshot.oscillatingNets.has(net);
	}

	function componentLabel(component: Component): string {
		return snapshot.layout[component.id]?.label ?? component.id;
	}

	function focusComponents(componentIds: readonly string[]) {
		store.setSelection(componentIds);
	}
</script>

<section class="sim-panel" data-testid="simulation-panel">
	<div class="panel-head">
		<h2>Simulation</h2>
		<span class="note">logic · {mode === 'physical' ? 'physical timing' : mode === 'timed' ? 'timed' : 'delta-cycle'}</span>
	</div>
	<div class="bar">
		<Controls
			{mode}
			{running}
			{tick}
			{ready}
			{pauseReason}
			onRun={run}
			onPause={pause}
			onStep={step}
			onReset={reset}
			onModeChange={changeMode}
		/>
		{#if snapshot.path.length > 0}
			<span class="note">Simulating the root circuit while editing {snapshot.path.at(-1)}.</span>
		{/if}
	</div>

	{#if mode === 'delta' && hasClock}
		<p class="note mode-hint" data-testid="clock-mode-hint">
			Delta-cycle simulation has no time to advance a clock. Choose timed or physical timing in
			Mode to run it.
		</p>
	{/if}

	<Diagnostics
		diagnostics={diagnosticList}
		onDismiss={(id) => diagnostics.dismiss(id)}
		onFocus={focusComponents}
	/>

	{#if ioComponents.length > 0}
		<div class="io">
			{#each ioComponents as component (component.id)}
				{#if component.kind === 'switch'}
					<button
						type="button"
						class="switch"
						onclick={() => toggleSwitch(component.id)}
						title="Toggle switch"
					>
						<span class="switch-name">{componentLabel(component)}</span>
						<span class="switch-value">{signalValue(component) ?? '–'}</span>
					</button>
				{:else}
					<Probe
						label={componentLabel(component)}
						value={signalValue(component)}
						oscillating={signalOscillating(component)}
					/>
				{/if}
			{/each}
		</div>
	{/if}

	<div class="waveform">
		<WaveformViewer
			{nets}
			tick={tick}
			{version}
			{mode}
			{selectedNets}
			historyFor={(net) => mirror.history(net)}
			onSelectNet={(net) => {
				const owners = snapshot.document.components
					.filter((component) =>
						Object.values(component.inputs).includes(net) ||
						Object.values(component.outputs).includes(net)
					)
					.map((component) => component.id);
				if (owners.length > 0) store.setSelection(owners);
			}}
		/>
	</div>
</section>

<style>
	.sim-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 0 12px 12px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
		overflow: hidden;
	}

	.panel-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 -12px 0;
		padding: 10px 12px;
		border-bottom: 1px solid var(--rule);
		background: var(--paper);
	}

	.panel-head h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.panel-head .note {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.note {
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--ink-faint);
	}

	.mode-hint {
		margin: 0;
		padding-left: 10px;
		border-left: 2px solid var(--warn);
	}

	.io {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.switch {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 9px;
		min-height: 28px;
	}

	.switch-name {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	.switch-value {
		font-family: var(--font-mono);
		font-weight: 600;
		font-size: 12px;
		color: var(--accent-strong);
	}

	.waveform {
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--paper);
		overflow: hidden;
		min-height: 150px;
	}
</style>
