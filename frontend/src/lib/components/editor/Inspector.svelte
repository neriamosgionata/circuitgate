<script lang="ts">
	import { untrack } from 'svelte';
	import { SUB_CIRCUIT_KIND } from '../../engine/hierarchy';
	import { primitiveKinds } from '../../engine/primitives';
	import type { Component } from '../../model/circuit';
	import type { CircuitEditorStore, EditorSnapshot } from '../../state/circuitStore';

	interface Props {
		store: CircuitEditorStore;
		readonly?: boolean;
	}

	let { store, readonly = false }: Props = $props();
	let snapshot = $state<EditorSnapshot>(untrack(() => store.snapshot));

	$effect(() => {
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	function resolveSelected(snap: EditorSnapshot): Component | null {
		if (snap.selection.size !== 1) return null;
		const [id] = [...snap.selection];
		return snap.document.components.find((component) => component.id === id) ?? null;
	}

	const selected = $derived(resolveSelected(snapshot));
	const flipFlopKinds = ['dFlipFlop', 'jkFlipFlop', 'srFlipFlop', 'srLatch'];
	const widthKinds = ['rom', 'ram', 'register', 'registerFile', 'rippleCarryAdder'];
	const kindOptions = $derived(Object.keys(primitiveKinds));

	function paramKind(value: unknown): 'number' | 'string' | 'boolean' | 'json' {
		if (typeof value === 'number') return 'number';
		if (typeof value === 'string') return 'string';
		if (typeof value === 'boolean') return 'boolean';
		return 'json';
	}

	function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
		try {
			return { ok: true, value: JSON.parse(text) };
		} catch {
			return { ok: false };
		}
	}

	function currentWidth(component: Component): number {
		const params = component.params ?? {};
		const raw = params['width'] ?? params['wordBits'];
		return typeof raw === 'number' && raw > 0 ? raw : 1;
	}
</script>

<aside class="inspector">
	<h2>Inspector</h2>
	{#if !selected}
		<p class="muted">
			{snapshot.selection.size === 0
				? 'Select a component to edit its properties.'
				: 'Select a single component to edit its properties.'}
		</p>
	{:else}
		<fieldset class="readonly-guard" disabled={readonly}>
		<fieldset>
			<legend>Identity</legend>
			<label>
				<span>Label</span>
				<input
					value={snapshot.layout[selected.id]?.label ?? ''}
					oninput={(event) => store.setLabel(selected.id, event.currentTarget.value)}
				/>
			</label>
			<label>
				<span>Kind</span>
				{#if selected.kind === SUB_CIRCUIT_KIND}
					<input value={String(selected.params?.['definition'] ?? '')} readonly />
				{:else}
					<select
						value={selected.kind}
						onchange={(event) => store.setComponentKind(selected.id, event.currentTarget.value)}
					>
						{#each kindOptions as kind (kind)}
							<option value={kind}>{kind}</option>
						{/each}
					</select>
				{/if}
			</label>
			{#if flipFlopKinds.includes(selected.kind)}
				<label>
					<span>Flip-flop type</span>
					<select
						value={selected.kind}
						onchange={(event) => store.setComponentKind(selected.id, event.currentTarget.value)}
					>
						{#each flipFlopKinds as kind (kind)}
							<option value={kind}>{kind}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if selected.kind === 'clock'}
				<label>
					<span>Clock polarity</span>
					<select
						value={String(selected.params?.['polarity'] ?? 'rising')}
						onchange={(event) =>
							store.setClockPolarity(
								selected.id,
								event.currentTarget.value === 'falling' ? 'falling' : 'rising'
							)}
					>
						<option value="rising">rising edge</option>
						<option value="falling">falling edge</option>
					</select>
				</label>
			{/if}
			{#if widthKinds.includes(selected.kind) || currentWidth(selected) > 1}
				<label>
					<span>Bus width</span>
					<input
						type="number"
						min="1"
						max="32"
						value={currentWidth(selected)}
						onchange={(event) => store.setBusWidth(selected.id, Number(event.currentTarget.value))}
					/>
				</label>
			{/if}
		</fieldset>

		<fieldset>
			<legend>Parameters</legend>
			{#if Object.keys(selected.params ?? {}).length === 0}
				<p class="muted">No parameters.</p>
			{/if}
			{#each Object.entries(selected.params ?? {}) as [key, value] (key)}
				<label>
					<span>{key}</span>
					{#if paramKind(value) === 'number'}
						<input
							type="number"
							value={Number(value)}
							onchange={(event) => store.setParam(selected.id, key, Number(event.currentTarget.value))}
						/>
					{:else if paramKind(value) === 'string'}
						<input
							value={String(value)}
							onchange={(event) => store.setParam(selected.id, key, event.currentTarget.value)}
						/>
					{:else if paramKind(value) === 'boolean'}
						<input
							type="checkbox"
							checked={Boolean(value)}
							onchange={(event) => store.setParam(selected.id, key, event.currentTarget.checked)}
						/>
					{:else}
						<textarea
							rows="3"
							value={JSON.stringify(value)}
							onchange={(event) => {
								const parsed = parseJson(event.currentTarget.value);
								if (parsed.ok) store.setParam(selected.id, key, parsed.value);
							}}
						></textarea>
					{/if}
				</label>
			{/each}
		</fieldset>
		</fieldset>
	{/if}
</aside>

<style>
	.inspector {
		width: 250px;
		min-width: 250px;
		overflow-y: auto;
		padding: 12px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
	}

	h2 {
		font-size: 14px;
		margin: 0 0 8px;
	}

	fieldset {
		border: 1px solid #eceff1;
		border-radius: 4px;
		padding: 8px;
		margin: 0 0 10px;
	}

	.readonly-guard {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	legend {
		font-size: 11px;
		text-transform: uppercase;
		color: #607d8b;
		padding: 0 4px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11px;
		color: #546e7a;
		margin-bottom: 8px;
	}

	input,
	select,
	textarea {
		font-size: 12px;
		padding: 3px 4px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		width: 100%;
		box-sizing: border-box;
	}

	input[type='checkbox'] {
		width: auto;
		align-self: flex-start;
	}

	.muted {
		font-size: 11px;
		color: #78909c;
	}
</style>
