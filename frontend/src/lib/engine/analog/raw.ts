/**
 * Parser for ngspice rawfiles: an ASCII header followed by little-endian
 * float64 samples (pairs for complex plots). Shared by the U1 Node spike
 * harness and the browser spike worker.
 */
export type RawValue = number | { re: number; im: number };

export interface RawVariable {
	name: string;
	type: string;
	values: RawValue[];
}

export interface RawPlot {
	plotname: string;
	complex: boolean;
	variables: RawVariable[];
}

export function parseRaw(bytes: Uint8Array): RawPlot {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const marker = 'Binary:\n';
	let markerIndex = -1;
	for (let i = 0; i + marker.length <= bytes.length; i++) {
		let match = true;
		for (let j = 0; j < marker.length; j++) {
			if (bytes[i + j] !== marker.charCodeAt(j)) {
				match = false;
				break;
			}
		}
		if (match) {
			markerIndex = i;
			break;
		}
	}
	if (markerIndex < 0) throw new Error('rawfile has no Binary section');

	const header = new TextDecoder('utf-8').decode(bytes.subarray(0, markerIndex));
	let numVariables = 0;
	let numPoints = 0;
	let complex = false;
	let plotname = '';
	const variables: RawVariable[] = [];
	let inVariables = false;

	for (const line of header.split('\n')) {
		if (line.startsWith('Plotname:')) plotname = line.slice('Plotname:'.length).trim();
		else if (line.startsWith('Flags:')) complex = line.slice('Flags:'.length).includes('complex');
		else if (line.startsWith('No. Variables:'))
			numVariables = Number(line.slice('No. Variables:'.length).trim());
		else if (line.startsWith('No. Points:')) numPoints = Number(line.slice('No. Points:'.length).trim());
		else if (line.startsWith('Variables:')) inVariables = true;
		else if (inVariables) {
			const match = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)/);
			if (match) variables.push({ name: match[2], type: match[3], values: [] });
		}
	}
	if (variables.length !== numVariables) {
		throw new Error(`rawfile declares ${numVariables} variables but lists ${variables.length}`);
	}

	const stride = complex ? 16 : 8;
	const dataStart = markerIndex + marker.length;
	for (let point = 0; point < numPoints; point++) {
		for (let variable = 0; variable < numVariables; variable++) {
			const offset = dataStart + (point * numVariables + variable) * stride;
			const re = view.getFloat64(offset, true);
			variables[variable].values.push(
				complex ? { re, im: view.getFloat64(offset + 8, true) } : re
			);
		}
	}
	return { plotname, complex, variables };
}

export function findVariable(plot: RawPlot, name: string): RawVariable {
	const variable = plot.variables.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
	if (!variable) throw new Error(`variable ${name} not found in ${plot.plotname}`);
	return variable;
}

export function realValues(variable: RawVariable): number[] {
	return variable.values.map((value) => (typeof value === 'number' ? value : value.re));
}

export function magnitudes(variable: RawVariable): number[] {
	return variable.values.map((value) =>
		typeof value === 'number' ? Math.abs(value) : Math.hypot(value.re, value.im)
	);
}
