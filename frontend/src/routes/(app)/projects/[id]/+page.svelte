<script lang="ts">
	import { page } from '$app/state';
	import Canvas from '../../../../lib/components/editor/Canvas.svelte';
	import Inspector from '../../../../lib/components/editor/Inspector.svelte';
	import Palette from '../../../../lib/components/editor/Palette.svelte';
	import SimulationPanel from '../../../../lib/components/sim/SimulationPanel.svelte';
	import { CircuitEditorStore } from '../../../../lib/state/circuitStore';

	// U4 keeps the editor on an in-memory store; U8 replaces this seed with a
	// project load through the API. The demo circuit exercises place/wire/render
	// end to end without any persistence.
	function place(store: CircuitEditorStore, kind: string, x: number, y: number) {
		const result = store.placeComponent(kind, { x, y });
		if (!result.ok) throw new Error(`could not place ${kind}: ${result.error}`);
		return result.value;
	}

	function createDemoStore(): CircuitEditorStore {
		const store = new CircuitEditorStore();
		const left = place(store, 'switch', 40, 80);
		const right = place(store, 'switch', 40, 200);
		const gate = place(store, 'and', 240, 120);
		const led = place(store, 'led', 440, 140);
		store.beginWire({ componentId: left.id, pin: 'out', side: 'output' });
		store.completeWire({ componentId: gate.id, pin: 'a', side: 'input' });
		store.beginWire({ componentId: right.id, pin: 'out', side: 'output' });
		store.completeWire({ componentId: gate.id, pin: 'b', side: 'input' });
		store.beginWire({ componentId: gate.id, pin: 'out', side: 'output' });
		store.completeWire({ componentId: led.id, pin: 'in', side: 'input' });
		store.clearSelection();
		return store;
	}

	const store = createDemoStore();
	let snapshot = $state(store.snapshot);

	$effect(() => {
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	const projectId = $derived(page.params.id);
</script>

<svelte:head>
	<title>{projectId} · CircuitGate</title>
</svelte:head>

<div class="page">
	<header class="toolbar">
		<nav class="crumbs">
			<button type="button" onclick={() => store.navigateTo(0)}>root</button>
			{#each snapshot.path as name, index (name + index)}
				<span class="sep">/</span>
				<button type="button" onclick={() => store.navigateTo(index + 1)}>{name}</button>
			{/each}
		</nav>
		<span class="project">Project {projectId}</span>
		<span class="muted">{snapshot.document.components.length} components</span>
	</header>
	<main class="editor">
		<Palette {store} />
		<div class="canvas-area">
			<div class="canvas-slot">
				<Canvas {store} />
			</div>
			<SimulationPanel {store} />
		</div>
		<Inspector {store} />
	</main>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: #eceff1;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: #ffffff;
		border-bottom: 1px solid #cfd8dc;
	}

	.crumbs {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.crumbs button {
		font-size: 12px;
		padding: 3px 7px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		background: #f5f7f8;
		cursor: pointer;
	}

	.sep {
		color: #90a4ae;
	}

	.project {
		font-size: 13px;
		font-weight: 600;
		color: #263238;
	}

	.muted {
		font-size: 12px;
		color: #78909c;
	}

	.editor {
		flex: 1;
		display: flex;
		gap: 10px;
		padding: 10px;
		min-height: 0;
		overflow: auto;
	}

	.canvas-area {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.canvas-slot {
		flex: 1 1 auto;
		min-height: 420px;
	}
</style>
