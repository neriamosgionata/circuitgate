<script lang="ts">
	import { untrack } from 'svelte';
	import { analogKind, isModelBackedKind } from '../../engine/analog/primitives';
	import { modelOptionsForKind, modelReferenceIssue } from '../../engine/analog/models';
	import { parseSI, stripTrailingUnit } from '../../engine/analog/si';
	import { kindNamesForDomain } from '../../engine/kinds';
	import { SUB_CIRCUIT_KIND } from '../../engine/hierarchy';
	import type { Component, ComponentId } from '../../model/circuit';
	import type { CircuitEditorStore, EditorSnapshot } from '../../state/circuitStore';

	interface Props {
		store: CircuitEditorStore;
		readonly?: boolean;
	}

	let { store, readonly = false }: Props = $props();
	let snapshot = $state<EditorSnapshot>(untrack(() => store.snapshot));
	let kindError = $state<string | null>(null);
	let paramError = $state<{ key: string; message: string } | null>(null);

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
	const kindOptions = $derived(kindNamesForDomain(snapshot.domain));
	const modelBacked = $derived(selected ? isModelBackedKind(selected.kind) : false);
	const modelOptions = $derived(
		selected ? modelOptionsForKind(selected.kind, snapshot.models) : []
	);
	const modelIssue = $derived(
		selected ? modelReferenceIssue(selected.kind, selected.params, snapshot.models) : null
	);
	const currentModel = $derived(
		selected && typeof selected.params?.['model'] === 'string'
			? String(selected.params['model'])
			: ''
	);
	const parameterSpecs = $derived(selected ? analogKind(selected.kind)?.parameters ?? [] : []);

	function enumOptions(key: string): readonly string[] | null {
		if (snapshot.domain !== 'analog') return null;
		const spec = parameterSpecs.find((candidate) => candidate.name === key);
		return spec?.kind === 'enum' ? spec.options ?? [] : null;
	}

	function changeKind(id: ComponentId, kind: string) {
		kindError = null;
		const result = store.setComponentKind(id, kind);
		if (result.ok) return;
		kindError =
			result.error === 'domain-mismatch'
				? 'Cannot change between logic and analog kinds in this project.'
				: result.error;
	}

	function commitAnalogNumber(id: ComponentId, key: string, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const parsed = parseSI(stripTrailingUnit(input.value).core);
		if (!parsed.ok) {
			paramError = { key, message: `Invalid value: ${parsed.error}` };
			const stored = resolveSelected(store.snapshot)?.params?.[key];
			input.value = typeof stored === 'number' ? String(stored) : '';
			return;
		}
		paramError = null;
		store.setParam(id, key, parsed.value);
	}

	function paramUnit(key: string): string {
		if (snapshot.domain !== 'analog' || !selected) return '';
		const unit = parameterSpecs.find((spec) => spec.name === key)?.unit;
		return unit === undefined || unit === '' ? '' : ` (${unit})`;
	}

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
						onchange={(event) => changeKind(selected.id, event.currentTarget.value)}
					>
						{#each kindOptions as kind (kind)}
							<option value={kind}>{kind}</option>
						{/each}
					</select>
				{/if}
			</label>
			{#if kindError}<p class="error" role="alert" data-testid="kind-error">{kindError}</p>{/if}
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

		{#if modelBacked}
			<fieldset>
				<legend>Model</legend>
				<label>
					<span>Model</span>
					<select
						value={currentModel}
						data-testid="model-select"
						onchange={(event) => {
							paramError = null;
							store.setParam(selected.id, 'model', event.currentTarget.value);
						}}
					>
						{#each modelOptions as option (option.name)}
							<option value={option.name}>{option.name} ({option.origin})</option>
						{/each}
						{#if currentModel && !modelOptions.some((option) => option.name === currentModel)}
							<option value={currentModel}>{currentModel} (unresolved)</option>
						{/if}
					</select>
				</label>
				{#if modelIssue}<p class="error" role="alert" data-testid="model-error">{modelIssue}</p>{/if}
			</fieldset>
		{/if}

		<fieldset>
			<legend>Parameters</legend>
			{#if Object.keys(selected.params ?? {}).length === 0}
				<p class="muted">No parameters.</p>
			{/if}
			{#each Object.entries(selected.params ?? {}) as [key, value] (key)}
				{#if !(modelBacked && key === 'model')}
					<label>
						<span>{key}{paramUnit(key)}</span>
						{#if paramKind(value) === 'number'}
							{#if snapshot.domain === 'analog'}
								<input
									value={String(value)}
									data-testid={`param-${key}`}
									onchange={(event) => commitAnalogNumber(selected.id, key, event)}
								/>
								{#if paramError?.key === key}
									<span class="error" role="alert" data-testid="param-error">{paramError.message}</span>
								{/if}
							{:else}
								<input
									type="number"
									value={Number(value)}
									onchange={(event) => store.setParam(selected.id, key, Number(event.currentTarget.value))}
								/>
							{/if}
						{:else if enumOptions(key)}
							<select
								value={String(value)}
								data-testid={`param-${key}`}
								onchange={(event) => store.setParam(selected.id, key, event.currentTarget.value)}
							>
								{#each enumOptions(key) ?? [] as option (option)}
									<option value={option}>{option}</option>
								{/each}
							</select>
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
				{/if}
			{/each}
		</fieldset>
		</fieldset>
	{/if}
</aside>

<style>
	.inspector {
		width: 252px;
		min-width: 252px;
		overflow-y: auto;
		padding: 12px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		box-shadow: var(--shadow-sheet);
	}

	h2 {
		font-size: 14px;
		margin: 0 0 8px;
		padding-bottom: 4px;
		border-bottom: 2px solid var(--ink);
	}

	fieldset {
		border: var(--rule-faint);
		border-radius: 2px;
		padding: 8px;
		margin: 0 0 10px;
		background: var(--sheet-raised);
	}

	.readonly-guard {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	legend {
		font-family: var(--font-head);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 0 4px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11px;
		color: var(--ink-soft);
		margin-bottom: 8px;
	}

	input,
	select,
	textarea {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 4px 5px;
		border: 1px solid var(--rule);
		border-radius: 2px;
		width: 100%;
		box-sizing: border-box;
		color: var(--ink);
		background: var(--sheet);
	}

	input[type='checkbox'] {
		width: auto;
		align-self: flex-start;
	}

	.muted {
		font-size: 11px;
		color: var(--ink-soft);
		margin: 0 0 6px;
	}

	.error {
		font-size: 11px;
		color: var(--stamp-red);
	}
</style>
