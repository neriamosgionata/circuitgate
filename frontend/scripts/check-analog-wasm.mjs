#!/usr/bin/env node
/**
 * U1 CI gate for the vendored analog engine artifact.
 *
 * Verifies the SHA-256 and byte size of every file recorded in
 * `src/lib/engine/analog/ngspice/manifest.json`, enforces the raw and
 * precompressed payload budgets from KTD9, and scans the wasm image for
 * copyleft-module markers that must not be compiled in.
 *
 * Run from `frontend/`: `node scripts/check-analog-wasm.mjs`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const engineDir = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/engine/analog/ngspice');
const manifest = JSON.parse(readFileSync(join(engineDir, 'manifest.json'), 'utf8'));

const failures = [];
const fail = (message) => failures.push(message);

let rawTotal = 0;
let wireTotal = 0;
const decoded = new Map();

for (const [name, artifact] of Object.entries(manifest.artifacts)) {
	const bytes = readFileSync(join(engineDir, artifact.path));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (bytes.length !== artifact.bytes) {
		fail(`${name}: ${bytes.length} bytes on disk, manifest records ${artifact.bytes}`);
	}
	if (sha256 !== artifact.sha256) {
		fail(`${name}: sha256 ${sha256}, manifest records ${artifact.sha256}`);
	}
	const gzipBytes = gzipSync(bytes, { level: 9 }).length;
	const brotliBytes = brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
	}).length;
	rawTotal += bytes.length;
	wireTotal += Math.min(gzipBytes, brotliBytes);
	decoded.set(name, Buffer.from(bytes).toString('latin1'));
	console.log(
		`${name}: ${bytes.length} B raw, ${gzipBytes} B gzip, ${brotliBytes} B brotli, sha256 ${sha256.slice(0, 16)}...`
	);
}

if (rawTotal > manifest.budget.rawBytesMax) {
	fail(`raw payload ${rawTotal} B exceeds ${manifest.budget.rawBytesMax} B`);
}
if (wireTotal > manifest.budget.wireBytesMax) {
	fail(`precompressed payload ${wireTotal} B exceeds ${manifest.budget.wireBytesMax} B`);
}

for (const marker of manifest.forbiddenMarkers) {
	for (const [name, text] of decoded) {
		if (text.includes(marker)) fail(`${name} contains forbidden marker "${marker}"`);
	}
}

console.log(
	`budget: ${rawTotal} B raw / ${manifest.budget.rawBytesMax} B, ${wireTotal} B precompressed / ${manifest.budget.wireBytesMax} B`
);

if (failures.length > 0) {
	for (const message of failures) console.error(`FAIL ${message}`);
	process.exit(1);
}
console.log('analog wasm manifest OK');
