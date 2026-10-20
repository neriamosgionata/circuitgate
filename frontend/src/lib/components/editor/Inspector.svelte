<script lang="ts">
	import { untrack } from 'svelte';
	import { analogKind, isModelBackedKind } from '../../engine/analog/primitives';
	import { modelOptionsForKind, modelReferenceIssue } from '../../engine/analog/models';
	import { parseSI, stripTrailingUnit } from '../../engine/analog/si';
	import { kindNamesForDomain, parameterShapeFor } from '../../engine/kinds';
	import {
		DEFAULT_ADDRESS_BITS,
		DEFAULT_WORD_BITS,
		DEFAULT_WIDTH,
		MAX_ADDRESS_BITS,
		MAX_WORD_BITS
	} from '../../engine/primitives/pins';
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
	let paramNotice = $state<string | null>(null);

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
	const selectedId = $derived(selected?.id ?? null);

	$effect(() => {
		void selectedId;
		paramError = null;
		paramNotice = null;
	});

	const flipFlopKinds = ['dFlipFlop', 'jkFlipFlop', 'srFlipFlop', 'srLatch'];
	const selectedShape = $derived(selected ? parameterShapeFor(selected.kind) : null);
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
	const visibleParams = $derived(
		selected
			? Object.entries(selected.params ?? {}).filter(
					([key]) => !(modelBacked && key === 'model') && !hiddenParamKeys(selected.kind).has(key)
				)
			: []
	);

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

	function readPositiveInt(raw: unknown, fallback: number): number {
		return typeof raw === 'number' && raw > 0 ? raw : fallback;
	}

	function currentWidth(component: Component): number {
		const params = component.params ?? {};
		return readPositiveInt(params['width'] ?? params['wordBits'], 1);
	}

	function currentWordBits(component: Component): number {
		return readPositiveInt(component.params?.['wordBits'], DEFAULT_WORD_BITS);
	}

	function currentAddressBits(component: Component): number {
		return readPositiveInt(component.params?.['addressBits'], DEFAULT_ADDRESS_BITS);
	}

	function currentRomContentsText(component: Component): string {
		return JSON.stringify(component.params?.['contents'] ?? []);
	}

	function romDepthText(component: Component): string {
		const contents = component.params?.['contents'];
		if (!Array.isArray(contents)) return 'Depth: — (contents invalid)';
		const depth = contents.length;
		if (depth < 1 || (depth & (depth - 1)) !== 0) return `Depth: — (${depth} words is not a power of two)`;
		const addressBits = Math.log2(depth);
		return `Depth: ${depth} word${depth === 1 ? '' : 's'} (${addressBits} address bit${addressBits === 1 ? '' : 's'})`;
	}

	/** Parameter keys covered by the dedicated parameterized-family controls. */
	function hiddenParamKeys(kind: string): ReadonlySet<string> {
		const shape = parameterShapeFor(kind);
		if (shape === 'memory') return new Set(['wordBits', 'addressBits']);
		if (shape === 'rom') return new Set(['wordBits', 'contents']);
		if (shape === 'width') return new Set(['width']);
		return new Set();
	}

	function parseIntInRange(
		text: string,
		min: number,
		max: number,
		noun: string
	): { ok: true; value: number } | { ok: false; message: string } {
		const trimmed = text.trim();
		const value = trimmed === '' ? NaN : Number(trimmed);
		if (!Number.isInteger(value) || value < min || value > max) {
			return {
				ok: false,
				message: `${noun} must be an integer from ${min} to ${max}, got ${trimmed === '' ? '(empty)' : trimmed}.`
			};
		}
		return { ok: true, value };
	}

	function parseWidthText(text: string): { ok: true; value: number } | { ok: false; message: string } {
		return parseIntInRange(text, 1, MAX_WORD_BITS, 'Width');
	}

	function parseAddressText(text: string): { ok: true; value: number } | { ok: false; message: string } {
		return parseIntInRange(text, 1, MAX_ADDRESS_BITS, 'Address width');
	}

	function reportDropped(dropped: number): void {
		paramNotice = dropped > 0 ? `${dropped} net${dropped === 1 ? '' : 's'} disconnected by this change.` : null;
	}

	function failParam(key: string, message: string): void {
		paramError = { key, message };
		paramNotice = null;
	}

	function reportResult(
		key: string,
		result: { ok: true; value: number } | { ok: false; error: string },
		invalidMessage: (error: string) => string
	): void {
		if (!result.ok) {
			failParam(key, invalidMessage(result.error));
			return;
		}
		paramError = null;
		reportDropped(result.value);
	}

	/** Bus/word width commit: validates inline, retains invalid text, never clamps. */
	function commitWidthText(id: ComponentId, key: 'width' | 'wordBits', text: string) {
		const parsed = parseWidthText(text);
		if (!parsed.ok) {
			failParam(key, parsed.message);
			return;
		}
		reportResult(key, store.setBusWidth(id, parsed.value), () => `Width must be an integer from 1 to ${MAX_WORD_BITS}, got ${text.trim()}.`);
	}

	function commitAddressText(id: ComponentId, text: string) {
		const parsed = parseAddressText(text);
		if (!parsed.ok) {
			failParam('addressBits', parsed.message);
			return;
		}
		reportResult('addressBits', store.setParam(id, 'addressBits', parsed.value), () => `Address width must be an integer from 1 to ${MAX_ADDRESS_BITS}, got ${text.trim()}.`);
	}

	function validateRomContents(
		text: string,
		wordBits: number
	): { ok: true; value: unknown } | { ok: false; message: string } {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return { ok: false, message: `ROM contents must be valid JSON: ${detail}.` };
		}
		if (!Array.isArray(parsed)) {
			return { ok: false, message: 'ROM contents must be an array of numbers.' };
		}
		if (parsed.length < 1 || (parsed.length & (parsed.length - 1)) !== 0) {
			return { ok: false, message: `ROM contents length must be a power of two, got ${parsed.length}.` };
		}
		const capacity = 2 ** wordBits;
		for (let index = 0; index < parsed.length; index++) {
			const word = parsed[index];
			if (!Number.isInteger(word) || (word as number) < 0 || (word as number) >= capacity) {
				return { ok: false, message: `ROM word ${index} (${String(word)}) does not fit in ${wordBits} bits.` };
			}
		}
		return { ok: true, value: parsed };
	}

	function commitRomContents(id: ComponentId, text: string, wordBits: number) {
		const validated = validateRomContents(text, wordBits);
		if (!validated.ok) {
			failParam('contents', validated.message);
			return;
		}
		const result = store.setParam(id, 'contents', validated.value);
		if (!result.ok) {
			failParam('contents', `ROM contents were rejected: ${result.error}.`);
			return;
		}
		paramError = null;
		reportDropped(result.value);
	}

	function commitLogicNumber(id: ComponentId, key: string, input: HTMLInputElement) {
		reportResult(key, store.setParam(id, key, Number(input.value)), (error) => `Invalid value for ${key}: ${error}.`);
	}

	function commitJsonParam(id: ComponentId, key: string, text: string) {
		const parsed = parseJson(text);
		if (!parsed.ok) {
			failParam(key, `${key} must be valid JSON.`);
			return;
		}
		const result = store.setParam(id, key, parsed.value);
		if (!result.ok) {
			failParam(key, `Invalid value for ${key}: ${result.error}.`);
			return;
		}
		paramError = null;
		reportDropped(result.value);
	}
</script>

{#snippet numericField(
	label: string,
	testId: string,
	errorTestId: string,
	value: number,
	errorKey: string,
	commit: (text: string) => void
)}
	<label>
		<span>{label}</span>
		<input
			type="text"
			inputmode="numeric"
			data-testid={testId}
			value={value}
			onchange={(event) => commit(event.currentTarget.value)}
		/>
	</label>
	{#if paramError?.key === errorKey}
		<p class="error" role="alert" data-testid={errorTestId}>{paramError.message}</p>
	{/if}
{/snippet}

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
		{#if selectedShape === 'width'}
			{@render numericField(
				'Bus width',
				'width-input',
				'width-error',
				currentWidth(selected),
				'width',
				(text) => commitWidthText(selected.id, 'width', text)
			)}
		{:else if selectedShape === 'memory'}
			{@render numericField(
				'Word width',
				'wordbits-input',
				'wordbits-error',
				currentWordBits(selected),
				'wordBits',
				(text) => commitWidthText(selected.id, 'wordBits', text)
			)}
			{@render numericField(
				'Address width',
				'addressbits-input',
				'addressbits-error',
				currentAddressBits(selected),
				'addressBits',
				(text) => commitAddressText(selected.id, text)
			)}
		{:else if selectedShape === 'rom'}
			{@render numericField(
				'Word width',
				'wordbits-input',
				'wordbits-error',
				currentWordBits(selected),
				'wordBits',
				(text) => commitWidthText(selected.id, 'wordBits', text)
			)}
			<label>
				<span>Contents (JSON)</span>
				<textarea
					rows="3"
					data-testid="contents-input"
					value={currentRomContentsText(selected)}
					onchange={(event) => commitRomContents(selected.id, event.currentTarget.value, currentWordBits(selected))}
				></textarea>
			</label>
			{#if paramError?.key === 'contents'}<p class="error" role="alert" data-testid="contents-error">{paramError.message}</p>{/if}
			<p class="muted" data-testid="rom-depth">{romDepthText(selected)}</p>
		{/if}
		{#if selectedShape !== null && paramNotice}
			<p class="notice" role="status" data-testid="param-notice">{paramNotice}</p>
		{/if}
		{#if selectedShape === null && currentWidth(selected) > 1}
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
			{#if visibleParams.length === 0}
				<p class="muted">No parameters.</p>
			{/if}
			{#each visibleParams as [key, value] (key)}
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
									onchange={(event) => commitLogicNumber(selected.id, key, event.currentTarget)}
								/>
								{#if paramError?.key === key}
									<span class="error" role="alert" data-testid="param-error">{paramError.message}</span>
								{/if}
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
								onchange={(event) => commitJsonParam(selected.id, key, event.currentTarget.value)}
							></textarea>
							{#if paramError?.key === key}
								<span class="error" role="alert" data-testid="param-error">{paramError.message}</span>
							{/if}
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

	.notice {
		font-size: 11px;
		color: var(--ink-soft);
		margin: 0 0 6px;
	}
</style>
