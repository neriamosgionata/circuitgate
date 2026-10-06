<script lang="ts">
	import { untrack } from 'svelte';
	import { resolveKind } from '../../engine/kinds';
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

	const logicGroups: { title: string; kinds: string[] }[] = [
		{ title: 'Gates', kinds: ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buffer'] },
		{ title: 'I/O and clock', kinds: ['switch', 'probe', 'led', 'clock'] },
		{ title: 'Sequential', kinds: ['dFlipFlop', 'jkFlipFlop', 'srFlipFlop', 'srLatch'] },
		{
			title: 'Arithmetic and routing',
			kinds: ['halfAdder', 'fullAdder', 'mux2', 'mux4', 'decoder2', 'decoder3']
		}
	];

	const analogGroups: { title: string; kinds: string[] }[] = [
		{ title: 'Sources', kinds: ['vsource', 'isource'] },
		{ title: 'Passives', kinds: ['resistor', 'capacitor', 'inductor', 'potentiometer'] },
		{ title: 'Diodes and transistors', kinds: ['diode', 'led', 'zener', 'bjt', 'mosfet'] },
		{ title: 'Switching', kinds: ['switch'] },
		{ title: 'Amplifiers and ICs', kinds: ['idealOpamp', 'opamp', 'comparator', 'timer555', 'regulator'] },
		{ title: 'Reference', kinds: ['ground'] }
	];

	const domain = $derived(snapshot.domain);
	const groups = $derived(domain === 'analog' ? analogGroups : logicGroups);
	const available = $derived(
		groups
			.map((group) => ({
				...group,
				kinds: group.kinds.filter((kind) => resolveKind(kind, domain))
			}))
			.filter((group) => group.kinds.length > 0)
	);
	const definitionNames = $derived(Object.keys(snapshot.definitions));

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
</script>

<aside class="palette" data-domain={domain}>
	<h2>Components</h2>
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
					>
						{kind}
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
		{/if}
		<div class="kinds">
			{#each definitionNames as name (name)}
				<button
					type="button"
					onclick={() => store.instantiateDefinition(name, { x: 80, y: 80 })}
					disabled={readonly}
				>
					{name}
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
		width: 220px;
		min-width: 220px;
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

	h3 {
		font-size: 12px;
		text-transform: uppercase;
		color: #607d8b;
		margin: 12px 0 6px;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	button {
		font-size: 12px;
		padding: 3px 7px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		background: #f5f7f8;
		cursor: pointer;
	}

	button.active {
		background: #1565c0;
		border-color: #1565c0;
		color: #ffffff;
	}

	button.wide {
		display: block;
		width: 100%;
		margin-top: 8px;
	}

	.pins {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 8px;
	}

	.pins label {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 11px;
	}

	.pins input {
		width: 80px;
	}

	.row {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}

	.muted {
		font-size: 11px;
		color: #78909c;
	}

	.error {
		font-size: 11px;
		color: #c62828;
	}
</style>
