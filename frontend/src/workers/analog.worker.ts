/**
 * Analog worker entry. The worker is compute-only: it handles protocol
 * messages and engine calls, performs no network or storage I/O beyond the
 * engine-asset fetch, and never loads the engine on initialize. The engine
 * bytes and glue load inside the run path, one fresh instance per analysis,
 * so cancel is terminate-and-respawn (KTD1, KTD9).
 */
/// <reference lib="webworker" />

import type { NgspiceModule, NgspiceModuleOptions } from '#lib/engine/analog/ngspice/ngspice.js';
import { findVariable, parseRaw, type RawPlot } from '#lib/engine/analog/raw';
import {
	isAnalogCommand,
	type AnalogAnalysisRequest,
	type AnalogResultVariable
} from '#lib/sim/analog/protocol';
import {
	AnalogHost,
	type AnalogAnalysisOutcome,
	type AnalogProgressUpdate
} from '#lib/sim/analog/session';

const scope = self as unknown as {
	postMessage: (message: unknown, transfer?: Transferable[]) => void;
	onmessage: ((event: MessageEvent) => void) | null;
};

const NOISE =
	/meminfo|statm|initialization file spinit|DRAM |ngspice program size|Shared ngspice pages|Text \(code\)|Stack = |Library pages|Total (analysis|elapsed)/;

interface EngineAsset {
	wasmUrl: string;
	compiled: WebAssembly.Module;
	createModule: (options: NgspiceModuleOptions) => Promise<NgspiceModule>;
}

let assetPromise: Promise<EngineAsset> | null = null;

function loadEngineAsset(): Promise<EngineAsset> {
	if (!assetPromise) {
		assetPromise = (async () => {
			const [{ default: createModule }, { default: wasmUrl }] = await Promise.all([
				import('#lib/engine/analog/ngspice/ngspice.js'),
				import('#lib/engine/analog/ngspice/ngspice.wasm?url')
			]);
			const response = await fetch(wasmUrl);
			if (!response.ok) throw new Error(`engine asset fetch failed: ${response.status}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const compiled = await WebAssembly.compile(bytes);
			return { wasmUrl, compiled, createModule };
		})();
	}
	return assetPromise;
}

async function createEngineInstance(
	asset: EngineAsset,
	collectDiagnostic: (line: string) => void
): Promise<NgspiceModule> {
	return asset.createModule({
		instantiateWasm(imports, success) {
			void WebAssembly.instantiate(asset.compiled, imports).then((result) =>
				success(result, asset.compiled)
			);
			return {};
		},
		noInitialRun: true,
		print: () => {},
		printErr: (text: string) => {
			for (const line of text.split('\n')) {
				if (line.trim() !== '' && !NOISE.test(line)) collectDiagnostic(line);
			}
		}
	});
}

function selectVariables(plot: RawPlot, requested?: string[]): AnalogResultVariable[] {
	const names = requested && requested.length > 0 ? requested : plot.variables.map((entry) => entry.name);
	return names.map((name) => {
		const source = findVariable(plot, name);
		const real = new Float64Array(source.values.length);
		const imag = plot.complex ? new Float64Array(source.values.length) : null;
		for (let index = 0; index < source.values.length; index++) {
			const value = source.values[index];
			if (typeof value === 'number') {
				real[index] = value;
			} else {
				real[index] = value.re;
				if (imag) imag[index] = value.im;
			}
		}
		return imag
			? { name: source.name, type: source.type, real, imag }
			: { name: source.name, type: source.type, real };
	});
}

const runner = async (
	analysis: AnalogAnalysisRequest,
	report: (update: AnalogProgressUpdate) => void
): Promise<AnalogAnalysisOutcome> => {
	report({ phase: 'loading-engine' });
	const asset = await loadEngineAsset();

	const engineDiagnostics: string[] = [];
	const started = performance.now();
	const module = await createEngineInstance(asset, (line) => engineDiagnostics.push(line));

	report({ phase: 'solving' });
	module.FS.writeFile('/circuit.cir', analysis.deck);
	const exitCode = module.callMain(['-b', '-r', '/out.raw', '/circuit.cir']);

	let plot: RawPlot | null = null;
	try {
		const raw = module.FS.readFile('/out.raw');
		if (typeof raw !== 'string' && exitCode === 0) {
			report({ phase: 'parsing' });
			plot = parseRaw(raw);
		}
	} catch {
		plot = null;
	}
	if (exitCode !== 0 || !plot) {
		throw new Error(engineDiagnostics.join(' | ') || `engine exited with code ${exitCode}`);
	}
	return {
		variables: selectVariables(plot, analysis.variables),
		engineDiagnostics,
		durationMs: performance.now() - started
	};
};

const host = new AnalogHost((event, transfer) => scope.postMessage(event, transfer), runner);

scope.onmessage = (event: MessageEvent) => {
	if (isAnalogCommand(event.data)) host.handle(event.data);
};
