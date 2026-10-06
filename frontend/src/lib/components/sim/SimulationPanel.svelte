<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { SubcircuitDefinitions } from '../../engine/hierarchy';
	import type { LogicValue } from '../../engine/values';
	import type { CircuitDocument, Component } from '../../model/circuit';
	import { DiagnosticsStore, type Diagnostic } from '../../sim/diagnostics';
	import { type SimulationEvent, type SimulationMode } from '../../sim/protocol';
	import { WaveformRecorder } from '../../sim/recorder';
	import { WorkerSimulationSession, type WorkerLike } from '../../sim/session';
	import type { CircuitEditorStore, EditorSnapshot } from '../../state/circuitStore';
	import WaveformViewer from '../waveform/WaveformViewer.svelte';
	import Controls from './Controls.svelte';
	import Diagnostics from './Diagnostics.svelte';
	import Probe from './Probe.svelte';

	interface Props {
		store: CircuitEditorStore;
	}

	let { store }: Props = $props();

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
	let mode = $state<SimulationMode>('delta');
	let running = $state(false);
	let tick = $state(0);
	let ready = $state(false);
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
				mode = event.mode;
				ready = true;
				break;
			case 'status':
				running = event.running;
				mode = event.mode;
				tick = event.tick;
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
				diagnostics.add(event.diagnostic);
				break;
			case 'restarted':
				mirror.clear();
				store.clearNetValues();
				nets = [];
				ready = false;
				running = false;
				tick = 0;
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
		version += 1;
		store.clearNetValues();
		session?.send({ type: 'reset', id: nextId() });
	}

	function changeMode(next: SimulationMode) {
		mode = next;
		mirror.clear();
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
	<div class="bar">
		<Controls
			{mode}
			{running}
			{tick}
			{ready}
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
		gap: 6px;
		padding: 8px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
		min-height: 0;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.note {
		font-size: 11px;
		color: #78909c;
	}

	.io {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		background: #f5f7f8;
		font-size: 12px;
		cursor: pointer;
	}

	.switch-value {
		font-weight: 700;
		color: #1565c0;
	}

	.waveform {
		flex: 1;
		min-height: 160px;
	}
</style>
