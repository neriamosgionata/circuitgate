import { writable } from 'svelte/store';

import { emitNetlist } from '../../engine/analog/netlist';
import { formatSI } from '../../engine/analog/si';
import type { CircuitDocument } from '../../model/circuit';
import type { AnalysisOutcome } from './results';

/**
 * Operating-point annotations drawn on the schematic. The analysis panel
 * publishes net voltages and branch currents after an operating-point run;
 * the canvas subscribes and positions the labels next to wires and devices.
 */
export interface AnalogAnnotation {
	key: string;
	net?: string;
	componentId?: string;
	label: string;
	text: string;
	value: number;
}

export const analogAnnotations = writable<readonly AnalogAnnotation[]>([]);

export function annotationsForOutcome(
	outcome: AnalysisOutcome,
	circuit: CircuitDocument
): AnalogAnnotation[] {
	if (outcome.kind !== 'op' || outcome.status !== 'complete') return [];
	let emission: ReturnType<typeof emitNetlist>;
	try {
		emission = emitNetlist(circuit, null);
	} catch {
		return [];
	}
	const byCurrent = new Map<string, (typeof emission.elements)[number]>();
	const byElement = new Map<string, (typeof emission.elements)[number]>();
	for (const element of emission.elements) {
		byElement.set(element.element.toLowerCase(), element);
		if (element.currentVariable) byCurrent.set(element.currentVariable.toLowerCase(), element);
	}
	const annotations: AnalogAnnotation[] = [];
	for (const variable of outcome.variables) {
		const value = variable.real[0];
		if (!Number.isFinite(value)) continue;
		const voltage = /^v\((.+)\)$/i.exec(variable.name.trim());
		if (voltage) {
			const node = voltage[1].trim();
			if (node === '0') continue;
			const net = emission.nodeMap.netForNode(node);
			if (!net) continue;
			annotations.push({
				key: `net:${net}`,
				net,
				label: net,
				value,
				text: `${net} ${formatSI(value)} V`
			});
			continue;
		}
		const current = /^i\((.+)\)$/i.exec(variable.name.trim());
		if (!current) continue;
		const elementName = current[1].trim().toLowerCase();
		const info = byCurrent.get(variable.name.trim().toLowerCase()) ?? byElement.get(elementName);
		if (!info) continue;
		annotations.push({
			key: `component:${info.componentId}:${info.element}`,
			componentId: info.componentId,
			label: info.element,
			value,
			text: `${info.element} ${formatSI(value)} A`
		});
	}
	return annotations;
}

export function publishAnnotations(outcome: AnalysisOutcome | null, circuit: CircuitDocument): void {
	analogAnnotations.set(outcome ? annotationsForOutcome(outcome, circuit) : []);
}

export function clearAnnotations(): void {
	analogAnnotations.set([]);
}
