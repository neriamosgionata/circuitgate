<script lang="ts">
	import { untrack } from 'svelte';
	import { analogKind, isModelBackedKind } from '../../engine/analog/primitives';
	import { modelOptionsForKind, modelReferenceIssue } from '../../engine/analog/models';
	import { parseSI, stripTrailingUnit } from '../../engine/analog/si';
	import { foreignParamNames, kindNamesForDomain, parameterShapeFor } from '../../engine/kinds';
	import { formatTimePs, nsToPs } from '../../engine/time';
	import {
		timingFieldsForKind,
		timingForComponent,
		validateTimingParam,
		type TimingField
	} from '../../engine/timing';
	import {
		DEFAULT_ADDRESS_BITS,
		DEFAULT_WORD_BITS,
		DEFAULT_WIDTH,
		MAX_ADDRESS_BITS,
		MAX_WORD_BITS
	} from '../../engine/primitives/pins';
	import { SUB_CIRCUIT_KIND } from '../../engine/hierarchy';
	import type { Component, ComponentId } from '../../model/circuit';
	import type { SimulationMode } from '../../sim/protocol';
	import type { CircuitEditorStore, EditorSnapshot } from '../../state/circuitStore';

	interface Props {
		store: CircuitEditorStore;
		mode?: SimulationMode;
		readonly?: boolean;
	}

	let { store, mode = 'delta', readonly = false }: Props = $props();
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
	const modelBacked = $derived(
		selected && snapshot.domain === 'analog' ? isModelBackedKind(selected.kind) : false
	);
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
	const timingFields = $derived(
		selected && snapshot.domain === 'logic' ? timingFieldsForKind(selected.kind) : []
	);
	const visibleParams = $derived(
		selected
			? Object.entries(selected.params ?? {}).filter(
					([key]) =>
						!(modelBacked && key === 'model') &&
						!hiddenParamKeys(selected.kind).has(key) &&
						!foreignParamNames(selected.kind, snapshot.domain).has(key)
				)
			: []
	);

	function safeTimingProfile(component: Component) {
		try {
			return timingForComponent(component.kind, component.params);
		} catch {
			return null;
		}
	}

	function timingLabel(field: TimingField): string {
		if (field === 'delay') return 'Propagation delay';
		if (field === 'clockToQ') return 'Clock-to-Q';
		if (field === 'setup') return 'Setup';
		if (field === 'hold') return 'Hold';
		if (field === 'period') return 'Period';
		return 'Duty (%)';
	}

	function timingValue(component: Component, field: TimingField): string {
		const raw = component.params?.[field];
		if (typeof raw === 'number') {
			if (field === 'duty') return String(raw);
			return formatTimePs(nsToPs(raw));
		}
		const profile = safeTimingProfile(component);
		if (!profile) return '';
		if (field === 'delay') return formatTimePs(profile.delayPs);
		if (field === 'clockToQ') return formatTimePs(profile.clockToQPs ?? 0);
		if (field === 'setup') return formatTimePs(profile.setupPs ?? 0);
		if (field === 'hold') return formatTimePs(profile.holdPs ?? 0);
		if (field === 'period') return formatTimePs(profile.periodPs ?? 0);
		return String((profile.duty ?? 0) * 100);
	}

	function hasTimingOverride(component: Component, field: TimingField): boolean {
		return typeof component.params?.[field] === 'number';
	}

	function parseTimingText(field: TimingField, text: string): { ok: true; value: number } | { ok: false; message: string } {
		const trimmed = text.trim();
		if (trimmed.length === 0) return { ok: false, message: 'Enter a value.' };
		if (field === 'duty') {
			const value = Number(trimmed.replace(/%$/, ''));
			if (!Number.isFinite(value)) return { ok: false, message: 'Duty must be a number.' };
			return { ok: true, value };
		}
		const withoutUnit = stripTrailingUnit(trimmed);
		if (withoutUnit.unit !== '' && withoutUnit.unit !== 's') {
			return { ok: false, message: 'Use ns, us, ms, or s for time values.' };
		}
		if (withoutUnit.unit === '') {
			const value = Number(withoutUnit.core);
			return Number.isFinite(value)
				? { ok: true, value }
				: { ok: false, message: 'Time must be a number.' };
		}
		const parsed = parseSI(withoutUnit.core);
		if (!parsed.ok) return { ok: false, message: `Invalid value: ${parsed.error}` };
		return { ok: true, value: parsed.value * 1e9 };
	}

	function commitTimingText(component: Component, field: TimingField, text: string): void {
		const parsed = parseTimingText(field, text);
		if (!parsed.ok) {
			failParam(field, parsed.message);
			return;
		}
		const validation = validateTimingParam(component.kind, field, parsed.value);
		if (!validation.ok) {
			failParam(field, validation.message);
			return;
		}
		reportResult(field, store.setParam(component.id, field, parsed.value), (error) =>
			error === 'invalid-clock-period'
				? 'The clock period is too short for a directly clocked part.'
				: `${timingLabel(field)} is invalid.`
		);
	}

	function resetTiming(component: Component, field: TimingField): void {
		paramError = null;
		const result = store.clearTimingParam(component.id, field);
		if (!result.ok) failParam(field, 'Could not reset this timing value.');
	}

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
		const keys = new Set<string>(timingFieldsForKind(kind));
		if (shape === 'memory') {
			keys.add('wordBits');
			keys.add('addressBits');
		}
		if (shape === 'rom') {
			keys.add('wordBits');
			keys.add('contents');
		}
		if (shape === 'width') keys.add('width');
		return keys;
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
	<div class="inspector-head">
		<h2>Inspector</h2>
		{#if selected}<span class="note">{selected.kind}</span>{/if}
	</div>
	{#if !selected}
		<div class="empty">
			<svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
				<path d="M8 36h26" />
				<path d="M34 22v28l22-14z" />
				<path d="M56 36h26" />
				<rect x="82" y="26" width="26" height="20" />
				<path d="M108 36h6" />
			</svg>
			<p class="empty-title">
				{snapshot.selection.size === 0
					? 'Nothing selected'
					: 'Several parts selected'}
			</p>
			<p class="muted">
				{snapshot.selection.size === 0
					? 'Click a part on the canvas to edit its properties.'
					: 'Select a single part to edit its properties.'}
			</p>
			<dl class="shortcuts">
				<div><dt><kbd>Click</kbd></dt><dd>Place a part, then click the canvas</dd></div>
				<div><dt><kbd>Drag</kbd></dt><dd>Wire from one pin to another</dd></div>
				<div><dt><kbd>Shift</kbd> + click</dt><dd>Select several parts</dd></div>
				<div><dt><kbd>Middle</kbd> drag</dt><dd>Pan the sheet</dd></div>
				<div><dt><kbd>Del</kbd></dt><dd>Delete the selection</dd></div>
				<div><dt><kbd>Esc</kbd></dt><dd>Cancel placing or wiring</dd></div>
			</dl>
		</div>
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

		{#if timingFields.length > 0}
			<fieldset class="timing" disabled={mode !== 'physical'}>
				<legend>Physical timing</legend>
				{#if mode !== 'physical'}
					<p class="muted" data-testid="timing-inactive-note">
						Timing values apply only in physical timing.
					</p>
				{/if}
				{#each timingFields as field (field)}
					<label>
						<span>{timingLabel(field)}</span>
						<input
							type="text"
							data-testid={`timing-${field}-input`}
							value={timingValue(selected, field)}
							onchange={(event) => commitTimingText(selected, field, event.currentTarget.value)}
						/>
						{#if !hasTimingOverride(selected, field)}
							<span class="muted" data-testid={`timing-${field}-default`}>Default</span>
						{/if}
						<button
							type="button"
							data-testid={`timing-${field}-reset`}
							disabled={!hasTimingOverride(selected, field)}
							onclick={() => resetTiming(selected, field)}
						>
							Reset
						</button>
					</label>
					{#if paramError?.key === field}
						<p class="error" role="alert" data-testid={`timing-${field}-error`}>
							{paramError.message}
						</p>
					{/if}
				{/each}
				<p class="muted">Clock polarity is not used in physical timing.</p>
			</fieldset>
		{/if}

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
		grid-area: inspector;
		width: 300px;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		padding: 0 12px 14px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
	}

	.inspector-head {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 -12px 12px;
		padding: 11px 12px;
		background: var(--paper);
		border-bottom: 1px solid var(--rule);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
	}

	h2 {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-soft);
		margin: 0;
	}

	.inspector-head .note {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--ink-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		padding: 14px 2px 4px;
	}

	.empty-title {
		margin: 0 0 4px;
		font-size: 14px;
		font-weight: 650;
		color: var(--ink);
	}

	.shortcuts {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin: 16px 0 0;
		padding: 0;
		border-top: 1px solid var(--rule);
	}

	.shortcuts > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 0;
		border-bottom: 1px solid var(--rule-faint);
	}

	.shortcuts dt {
		flex: none;
		font-size: 10.5px;
		color: var(--ink-soft);
	}

	.shortcuts dd {
		margin: 0;
		text-align: right;
		font-size: 11px;
		line-height: 1.35;
		color: var(--ink-faint);
	}

	kbd {
		display: inline-block;
		padding: 1px 5px;
		border: 1px solid var(--rule-strong);
		border-bottom-width: 2px;
		border-radius: var(--radius-xs);
		background: var(--paper-soft);
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-soft);
	}

	.empty svg {
		width: 96px;
		height: auto;
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.4;
		opacity: 0.55;
		margin-bottom: 10px;
	}

	fieldset {
		border: 0;
		border-top: 1px solid var(--rule);
		border-radius: 0;
		padding: 10px 0 2px;
		margin: 0 0 4px;
		background: transparent;
	}

	fieldset:first-of-type {
		border-top: 0;
		padding-top: 0;
	}

	.readonly-guard {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	legend {
		font-size: 9.5px;
		font-weight: 650;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding: 0;
		margin-bottom: 8px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		margin-bottom: 9px;
	}

	label > span {
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	input,
	select,
	textarea {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 6px 8px;
		min-height: 32px;
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
		width: 100%;
		box-sizing: border-box;
		color: var(--ink);
		background: var(--paper);
	}

	select {
		padding-right: 26px;
	}

	input[type='checkbox'] {
		width: auto;
		min-height: 0;
		align-self: flex-start;
	}

	.muted {
		font-size: 12px;
		color: var(--ink-soft);
		margin: 0 0 6px;
	}

	.error {
		font-size: 11px;
		color: var(--danger);
		padding: 0;
		border: 0;
		background: none;
	}

	.notice {
		font-size: 11.5px;
		color: var(--ink-soft);
		margin: 0 0 6px;
	}

	@media (max-width: 1080px) {
		.inspector {
			width: 100%;
			overflow-y: visible;
		}
	}
</style>
