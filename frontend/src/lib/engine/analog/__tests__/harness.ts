/**
 * U1 spike harness: loads the vendored license-clean ngspice-WASM artifact
 * under Node (vitest) and runs SPICE decks.
 *
 * Emscripten's `main` runs once per module instance, so every run gets a
 * fresh instance that shares one compiled `WebAssembly.Module`. That is also
 * the cancellation story U1 records for U2: terminate-and-respawn, with a
 * fresh instance as the cheap in-process equivalent.
 */
import { readFileSync } from 'node:fs';

import {
	findVariable,
	magnitudes,
	parseRaw,
	realValues,
	type RawPlot,
	type RawValue,
	type RawVariable
} from '../raw';
import createNgspiceModule, {
	type NgspiceModule,
	type NgspiceModuleOptions
} from '../ngspice/ngspice.js';

export { findVariable, magnitudes, parseRaw, realValues };
export type { RawPlot, RawValue, RawVariable };

export const WASM_PATH = new URL('../ngspice/ngspice.wasm', import.meta.url);
export const FIXTURES_DIR = new URL('../../../../../tests/fixtures/analog-spike/', import.meta.url);

export interface ExecutionResult {
	/** Rawfile bytes when the run produced one; null when the engine failed. */
	raw: Uint8Array | null;
	/** Milliseconds spent creating and initializing the module instance. */
	instantiateMs: number;
	/** Milliseconds for the whole run (instantiate + solve + raw read). */
	totalMs: number;
	/** stderr captured from the engine, excluding known wasm-platform noise. */
	diagnostics: string[];
	exitCode: number;
}

export interface RunResult extends Omit<ExecutionResult, 'raw'> {
	plot: RawPlot;
}

let compiledModule: Promise<WebAssembly.Module> | null = null;
let compileMs: number | null = null;

function compiled(): Promise<WebAssembly.Module> {
	if (!compiledModule) {
		const started = performance.now();
		const bytes = readFileSync(WASM_PATH);
		compiledModule = WebAssembly.compile(bytes).then((module) => {
			compileMs = performance.now() - started;
			return module;
		});
	}
	return compiledModule;
}

/** Compile time of the wasm module in milliseconds (available after the first load). */
export function getCompileMs(): number | null {
	return compileMs;
}

const PLATFORM_NOISE =
	/meminfo|statm|initialization file spinit|DRAM (available|currently)|ngspice program size|Shared ngspice pages|Text \(code\) pages|Stack = |Library pages|Total (analysis|elapsed) time/;

export async function createInstance(
	options: NgspiceModuleOptions = {}
): Promise<{ module: NgspiceModule; instantiateMs: number }> {
	const module = await compiled();
	const started = performance.now();
	const instance = await createNgspiceModule({
		instantiateWasm(imports, success) {
			void WebAssembly.instantiate(module, imports).then((result) => success(result, module));
			return {};
		},
		noInitialRun: true,
		...options
	});
	return { module: instance, instantiateMs: performance.now() - started };
}

/** Execute one deck in a fresh engine instance; engine failures do not throw. */
export async function executeDeck(
	deck: string,
	options: NgspiceModuleOptions = {}
): Promise<ExecutionResult> {
	const diagnostics: string[] = [];
	const collectErrors = (text: string): void => {
		for (const line of text.split('\n')) {
			if (line.trim() !== '' && !PLATFORM_NOISE.test(line)) diagnostics.push(line);
		}
	};
	const started = performance.now();
	const { module, instantiateMs } = await createInstance({
		print: () => {},
		printErr: collectErrors,
		...options
	});
	module.FS.writeFile('/circuit.cir', deck);
	const exitCode = module.callMain(['-b', '-r', '/out.raw', '/circuit.cir']);
	let raw: Uint8Array | null = null;
	try {
		const bytes = module.FS.readFile('/out.raw');
		raw = typeof bytes === 'string' ? null : bytes;
	} catch {
		raw = null;
	}
	return {
		raw,
		instantiateMs,
		totalMs: performance.now() - started,
		diagnostics,
		exitCode
	};
}

/** Run one deck and return the parsed raw plot; throws when the engine fails. */
export async function runDeck(deck: string, options: NgspiceModuleOptions = {}): Promise<RunResult> {
	const result = await executeDeck(deck, options);
	if (result.exitCode !== 0 || !result.raw) {
		throw new Error(
			`deck failed (exit ${result.exitCode}): ${result.diagnostics.join(' | ') || 'no diagnostic'}`
		);
	}
	return { ...result, plot: parseRaw(result.raw) };
}

/** Linear interpolation of y at x over a monotonically increasing series. */
export function sampleAt(xs: number[], ys: number[], x: number): number {
	if (x <= xs[0]) return ys[0];
	const last = xs.length - 1;
	if (x >= xs[last]) return ys[last];
	let low = 0;
	let high = last;
	while (high - low > 1) {
		const mid = (low + high) >> 1;
		if (xs[mid] <= x) low = mid;
		else high = mid;
	}
	const span = xs[high] - xs[low];
	const t = span === 0 ? 0 : (x - xs[low]) / span;
	return ys[low] + t * (ys[high] - ys[low]);
}

/** Frequency where a low-pass magnitude crosses -3 dB, interpolated in log frequency. */
export function lowPassCorner(frequencies: number[], magnitudes: number[]): number {
	const peak = Math.max(...magnitudes);
	const target = peak * Math.SQRT1_2;
	for (let i = 1; i < magnitudes.length; i++) {
		const previous = magnitudes[i - 1];
		const current = magnitudes[i];
		if (previous >= target && current < target && previous !== current) {
			const t = (previous - target) / (previous - current);
			return frequencies[i - 1] * Math.pow(frequencies[i] / frequencies[i - 1], t);
		}
	}
	throw new Error('no low-pass corner in sweep');
}

/** Thevenin equivalent of a resistive divider from `top` volts to ground. */
export function thevenin(top: number, rHigh: number, rLow: number): { vth: number; rth: number } {
	return {
		vth: (top * rLow) / (rHigh + rLow),
		rth: (rHigh * rLow) / (rHigh + rLow)
	};
}
