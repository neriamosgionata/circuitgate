<script lang="ts">
	import { untrack } from 'svelte';
	import { resolveKind } from '../../engine/kinds';
	import { SYMBOL_PATHS, symbolKeyFor } from '../../render/symbols';
	import type { CircuitEditorStore, EditorSnapshot, PackagingDraft } from '../../state/circuitStore';

	function pinNameFor(
		draft: PackagingDraft,
		netId: string,
		direction: 'input' | 'output'
	): string {
		const map = direction === 'input' ? draft.inputs : draft.outputs;
		for (const [name, target] of Object.entries(map)) {
			if (target === netId) return name;
		}
		return '';
	}

	interface Props {
		store: CircuitEditorStore;
		readonly?: boolean;
	}

	let { store, readonly = false }: Props = $props();
	let snapshot = $state<EditorSnapshot>(untrack(() => store.snapshot));
	let packageName = $state('');
	let packageError = $state<string | null>(null);
	let filter = $state('');

	const logicGroups: { title: string; kinds: string[] }[] = [
		{ title: 'Gates', kinds: ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buffer'] },
		{ title: 'I/O and clock', kinds: ['switch', 'probe', 'led', 'clock'] },
		{ title: 'Sequential', kinds: ['dFlipFlop', 'jkFlipFlop', 'srFlipFlop', 'srLatch', 'counter', 'shiftRegister'] },
		{
			title: 'Arithmetic and routing',
			kinds: ['halfAdder', 'fullAdder', 'mux2', 'mux4', 'decoder2', 'decoder3', 'triStateBuffer']
		},
		{ title: 'Display', kinds: ['sevenSegDecoder', 'sevenSegDisplay'] },
		{
			title: 'Wide logic',
			kinds: ['rippleCarryAdder', 'magnitudeComparator', 'register', 'registerFile', 'ram', 'rom']
		}
	];

	const analogGroups: { title: string; kinds: string[] }[] = [
		{ title: 'Sources', kinds: ['vsource', 'isource'] },
		{ title: 'Passives', kinds: ['resistor', 'capacitor', 'inductor', 'potentiometer'] },
		{ title: 'Diodes and transistors', kinds: ['diode', 'led', 'zener', 'bjt', 'pnp', 'mosfet', 'bridge'] },
		{ title: 'Switching', kinds: ['switch'] },
		{ title: 'Amplifiers and ICs', kinds: ['idealOpamp', 'opamp', 'comparator', 'timer555', 'regulator'] },
		{ title: 'Reference', kinds: ['ground'] }
	];

	const domain = $derived(snapshot.domain);
	const groups = $derived(domain === 'analog' ? analogGroups : logicGroups);
	const filterText = $derived(filter.trim().toLowerCase());
	const available = $derived(
		groups
			.map((group) => ({
				...group,
				kinds: group.kinds.filter(
					(kind) => resolveKind(kind, domain) && kind.toLowerCase().includes(filterText)
				)
			}))
			.filter((group) => group.kinds.length > 0)
	);
	const definitionNames = $derived(Object.keys(snapshot.definitions));
	const filteredDefinitions = $derived(
		definitionNames.filter((name) => name.toLowerCase().includes(filterText))
	);
	const noMatches = $derived(
		filterText.length > 0 &&
			available.length === 0 &&
			(domain !== 'logic' || filteredDefinitions.length === 0)
	);

	$effect(() => {
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	function beginPackaging() {
		if (readonly) return;
		packageError = null;
		const result = store.beginPackaging();
		if (!result.ok) {
			packageError =
				result.error === 'empty-selection'
					? 'Select components first, then package them.'
					: result.error;
		}
	}

	function confirmPackaging() {
		if (readonly) return;
		const result = store.confirmPackage(packageName);
		if (!result.ok) {
			packageError = result.error;
			return;
		}
		packageName = '';
		packageError = null;
	}

	function selectedDefinitionName(): string | null {
		if (snapshot.selection.size !== 1) return null;
		const [id] = [...snapshot.selection];
		const component = snapshot.document.components.find((candidate) => candidate.id === id);
		const name = component?.params?.['definition'];
		return typeof name === 'string' ? name : null;
	}

	const selectedInstance = $derived(selectedDefinitionName());

	const iconFor = (kind: string): string => SYMBOL_PATHS[symbolKeyFor(kind)] ?? SYMBOL_PATHS.generic;

	const KIND_LABELS: Record<string, string> = {
		and: 'AND', or: 'OR', not: 'NOT', nand: 'NAND', nor: 'NOR', xor: 'XOR', xnor: 'XNOR',
		buffer: 'Buffer', switch: 'Switch', probe: 'Probe', led: 'LED', clock: 'Clock',
		dFlipFlop: 'D flip-flop', jkFlipFlop: 'JK flip-flop', srFlipFlop: 'SR flip-flop',
		srLatch: 'SR latch', counter: 'Counter', shiftRegister: 'Shift register',
		halfAdder: 'Half adder', fullAdder: 'Full adder', mux2: 'Mux 2:1', mux4: 'Mux 4:1',
		decoder2: 'Decoder 2→4', decoder3: 'Decoder 3→8', triStateBuffer: 'Tri-state buffer',
		sevenSegDecoder: '7-seg decoder', sevenSegDisplay: '7-seg display',
		rippleCarryAdder: 'Ripple adder', magnitudeComparator: 'Comparator',
		register: 'Register', registerFile: 'Register file', ram: 'RAM', rom: 'ROM',
		vsource: 'V source', isource: 'I source', resistor: 'Resistor', capacitor: 'Capacitor',
		inductor: 'Inductor', potentiometer: 'Potentiometer', diode: 'Diode', zener: 'Zener',
		bjt: 'NPN BJT', pnp: 'PNP BJT', mosfet: 'MOSFET', bridge: 'Bridge',
		idealOpamp: 'Ideal op-amp', opamp: 'Op-amp', comparator: 'Comparator',
		timer555: '555 timer', regulator: 'Regulator', ground: 'Ground'
	};

	const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;
</script>

<aside class="palette" data-domain={domain}>
	<div class="palette-head">
		<h2>Components</h2>
		<label class="filter">
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<circle cx="6.5" cy="6.5" r="4.2" />
				<path d="M9.8 9.8 14 14" />
			</svg>
			<span class="visually-hidden">Filter parts</span>
			<input type="search" placeholder="Filter parts" bind:value={filter} />
		</label>
		<p class="place-hint">Pick a part, then click the canvas.</p>
	</div>
	{#if noMatches}
		<p class="muted">No parts match “{filter.trim()}”.</p>
	{/if}
	{#each available as group (group.title)}
		<section>
			<h3>{group.title}</h3>
			<div class="kinds">
				{#each group.kinds as kind (kind)}
					<button
						type="button"
						class:active={snapshot.pendingKind === kind}
						onclick={() => store.beginPlacement(kind)}
						disabled={readonly}
						aria-label={kind}
						title={kindLabel(kind)}
					>
						<svg class="kind-icon" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
							<path d={iconFor(kind)} />
						</svg>
						<span>{kindLabel(kind)}</span>
					</button>
				{/each}
			</div>
		</section>
	{/each}

	{#if domain === 'logic'}
	<section>
		<h3>Subcircuits</h3>
		{#if definitionNames.length === 0}
			<p class="muted">Package a selection to create one.</p>
		{:else if filteredDefinitions.length === 0}
			<p class="muted">No subcircuits match “{filter.trim()}”.</p>
		{/if}
		<div class="kinds">
			{#each filteredDefinitions as name (name)}
				<button
					type="button"
					onclick={() => store.instantiateDefinition(name, { x: 80, y: 80 })}
					disabled={readonly}
					aria-label={name}
					title={name}
				>
					<svg class="kind-icon" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
						<path d={iconFor('subcircuit')} />
					</svg>
					<span>{name}</span>
				</button>
			{/each}
		</div>
		{#if selectedInstance}
			<button
				class="wide"
				type="button"
				onclick={() => store.enterDefinition(selectedInstance)}
				disabled={readonly}
			>
				Edit definition “{selectedInstance}”
			</button>
		{/if}
	</section>

	<section class="packaging">
		<h3>Package selection</h3>
		{#if !snapshot.packaging}
			<button class="wide" type="button" onclick={beginPackaging} disabled={readonly}>
				Package selection as subcircuit
			</button>
			{#if packageError}<p class="error">{packageError}</p>{/if}
		{:else}
			<p class="muted">Define the pin interface, then name the subcircuit.</p>
			<div class="pins">
				{#each snapshot.packaging.candidates as candidate (candidate.netId)}
					<label>
						<span>{candidate.direction === 'input' ? 'in' : 'out'}</span>
						<input
							value={candidate.direction === 'input'
								? pinNameFor(snapshot.packaging, candidate.netId, 'input')
								: pinNameFor(snapshot.packaging, candidate.netId, 'output')}
							onchange={(event) =>
								store.renamePackagingPin(candidate.netId, event.currentTarget.value)}
							disabled={readonly}
						/>
						<small>{candidate.netId}</small>
					</label>
				{/each}
			</div>
			<input placeholder="definition name" bind:value={packageName} disabled={readonly} />
			<div class="row">
				<button type="button" onclick={confirmPackaging} disabled={readonly}>Create</button>
				<button type="button" onclick={() => store.cancelPackaging()}>Cancel</button>
			</div>
			{#if packageError}<p class="error">{packageError}</p>{/if}
		{/if}
	</section>
	{/if}
</aside>

<style>
	.palette {
		grid-area: palette;
		width: 244px;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		padding: 0 10px 12px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
	}

	.palette-head {
		position: sticky;
		top: 0;
		z-index: 2;
		margin: 0 -10px 10px;
		padding: 10px 12px 10px;
		background: var(--paper);
		border-bottom: 1px solid var(--rule);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
	}

	.place-hint {
		margin: 7px 0 0;
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--ink-faint);
	}

	h2 {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-soft);
		margin: 0;
	}

	.filter {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		padding: 0 8px;
		background: var(--paper);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
	}

	.filter:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.filter svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: var(--ink-faint);
		stroke-width: 1.6;
		flex: none;
	}

	.filter input {
		flex: 1;
		min-width: 0;
		min-height: 32px;
		padding: 2px 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		font-size: 12.5px;
	}

	.filter input:focus {
		outline: none;
		box-shadow: none;
	}

	h3 {
		font-family: var(--font-ui);
		font-size: 9.5px;
		font-weight: 650;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 14px 0 6px;
	}

	section:first-of-type h3 {
		margin-top: 2px;
	}

	.kinds {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 5px;
	}

	button {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		width: 100%;
		min-width: 0;
		min-height: 56px;
		font-size: 9.5px;
		font-weight: 550;
		padding: 6px 4px;
		text-align: center;
		line-height: 1.15;
		letter-spacing: 0.01em;
		text-transform: none;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		box-shadow: none;
	}

	button:hover:not(:disabled) {
		border-color: var(--accent-line);
		background: var(--accent-soft);
	}

	button span {
		min-width: 0;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.kind-icon {
		width: 30px;
		height: 18px;
		flex: none;
	}

	.palette[data-domain='analog'] .kind-icon {
		color: var(--analog);
	}

	.kind-icon path {
		fill: none;
		stroke: currentColor;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	button.active {
		border-color: var(--accent);
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}

	button.wide {
		display: block;
		width: 100%;
		margin-top: 8px;
		min-height: 32px;
		font-size: 11.5px;
		padding: 6px 8px;
	}

	.pins {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	.pins label {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 11px;
	}

	.pins input {
		width: 78px;
		min-height: 28px;
		padding: 3px 6px;
	}

	.row {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}

	.row button {
		min-height: 30px;
		font-size: 11.5px;
		padding: 5px 8px;
	}

	.muted {
		font-size: 11.5px;
		color: var(--ink-faint);
		margin: 6px 0;
	}

	.error {
		font-size: 11px;
		color: var(--danger);
		padding: 0;
		border: 0;
		background: none;
	}

	@media (max-width: 1080px) {
		.palette {
			width: 100%;
			max-height: 240px;
			overflow-y: auto;
		}

		.kinds {
			grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
		}
	}
</style>
