/**
 * Minimal U1 browser harness worker: loads the vendored engine asset and runs
 * one deck per worker. This is plumbing for the spike only; U2 owns the real
 * analog worker, versioned protocol, lifecycle, progress, and cancellation.
 */
/// <reference lib="webworker" />

import createNgspiceModule from '#lib/engine/analog/ngspice/ngspice.js';
import wasmUrl from '#lib/engine/analog/ngspice/ngspice.wasm?url';
import { parseRaw, type RawPlot } from '#lib/engine/analog/raw';

export interface SpikeRequest {
	deck: string;
}

export interface SpikeResponse {
	ok: boolean;
	exitCode: number;
	plot: RawPlot | null;
	diagnostics: string[];
	wasmUrl: string;
	timings: {
		fetchMs: number;
		instantiateMs: number;
		runMs: number;
		totalMs: number;
	};
	error?: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const NOISE = /meminfo|statm|initialization file spinit|DRAM |ngspice program size|Shared ngspice pages|Text \(code\)|Stack = |Library pages|Total (analysis|elapsed)/;

scope.onmessage = async (event: MessageEvent<SpikeRequest>) => {
	const started = performance.now();
	const diagnostics: string[] = [];
	try {
		const fetchStarted = performance.now();
		const response = await fetch(wasmUrl);
		if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		const fetchMs = performance.now() - fetchStarted;

		const instantiateStarted = performance.now();
		const module = await createNgspiceModule({
			wasmBinary: bytes,
			noInitialRun: true,
			print: () => {},
			printErr: (text: string) => {
				for (const line of text.split('\n')) {
					if (line.trim() !== '' && !NOISE.test(line)) diagnostics.push(line);
				}
			}
		});
		const instantiateMs = performance.now() - instantiateStarted;

		const runStarted = performance.now();
		module.FS.writeFile('/circuit.cir', event.data.deck);
		const exitCode = module.callMain(['-b', '-r', '/out.raw', '/circuit.cir']);
		let plot: RawPlot | null = null;
		try {
			const raw = module.FS.readFile('/out.raw');
			if (typeof raw !== 'string' && exitCode === 0) plot = parseRaw(raw);
		} catch {
			plot = null;
		}
		const runMs = performance.now() - runStarted;

		const message: SpikeResponse = {
			ok: exitCode === 0 && plot !== null,
			exitCode,
			plot,
			diagnostics,
			wasmUrl,
			timings: { fetchMs, instantiateMs, runMs, totalMs: performance.now() - started }
		};
		scope.postMessage(message);
	} catch (cause) {
		const message: SpikeResponse = {
			ok: false,
			exitCode: -1,
			plot: null,
			diagnostics,
			wasmUrl,
			timings: { fetchMs: 0, instantiateMs: 0, runMs: 0, totalMs: performance.now() - started },
			error: cause instanceof Error ? cause.message : String(cause)
		};
		scope.postMessage(message);
	}
};
