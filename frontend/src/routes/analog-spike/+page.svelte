<script lang="ts">
	import { onMount } from 'svelte';

	import type { SpikeResponse } from '#lib/engine/analog/spike/worker';
	import workerUrl from '#lib/engine/analog/spike/worker?worker&url';

	interface SpikeWindow {
		__analogSpike?: {
			start: (deck: string) => Promise<SpikeResponse>;
			terminate: () => void;
			divider: SpikeResponse | null;
		};
	}

	const DIVIDER_DECK = `* U1 browser spike: resistive divider
V1 1 0 DC 12
R1 1 2 10k
R2 2 0 10k
.op
.end
`;

	let status = $state<'starting' | 'ok' | 'error'>('starting');
	let detail = $state('loading engine');
	let current: Worker | null = null;

	function start(deck: string): Promise<SpikeResponse> {
		current?.terminate();
		const worker = new Worker(workerUrl, { type: 'module' });
		current = worker;
		return new Promise((resolve, reject) => {
			worker.onmessage = (event: MessageEvent<SpikeResponse>) => resolve(event.data);
			worker.onerror = (event) => reject(new Error(event.message));
			worker.postMessage({ deck });
		});
	}

	function terminate(): void {
		current?.terminate();
	}

	onMount(() => {
		const api = { start, terminate, divider: null as SpikeResponse | null };
		(window as unknown as SpikeWindow).__analogSpike = api;
		start(DIVIDER_DECK)
			.then((message) => {
				api.divider = message;
				if (message.ok && message.plot) {
					const midpoint = message.plot.variables.find((variable) => variable.name === 'v(2)');
					const value =
						midpoint && typeof midpoint.values[0] === 'number' ? midpoint.values[0] : Number.NaN;
					detail = `v(2)=${value.toFixed(4)} V; fetch=${message.timings.fetchMs.toFixed(0)}ms instantiate=${message.timings.instantiateMs.toFixed(0)}ms run=${message.timings.runMs.toFixed(0)}ms`;
					status = 'ok';
				} else {
					detail = message.error ?? (message.diagnostics.join(' | ') || 'engine run failed');
					status = 'error';
				}
			})
			.catch((cause: unknown) => {
				detail = cause instanceof Error ? cause.message : String(cause);
				status = 'error';
			});
		return () => current?.terminate();
	});
</script>

<svelte:head>
	<title>Analog engine spike - CircuitGate</title>
</svelte:head>

<main>
	<h1>Analog engine spike</h1>
	<p>U1 browser proof harness: runs the vendored ngspice-WASM engine in a module worker.</p>
	<p data-testid="analog-spike-status">{status}</p>
	<p data-testid="analog-spike-detail">{detail}</p>
</main>

<style>
	main {
		max-width: 48rem;
		margin: 4rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
</style>
