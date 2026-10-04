import type { ComponentKind } from '../compile';
import type { LogicValue } from '../values';

export const mux2: ComponentKind = {
	inputs: ['d0', 'd1', 'sel'],
	outputs: ['out'],
	evaluate: ([d0, d1, sel]) => ({ outputs: [sel === 0 ? d0 : sel === 1 ? d1 : 'X'] })
};

// sel0 is the least significant select bit.
export const mux4: ComponentKind = {
	inputs: ['d0', 'd1', 'd2', 'd3', 'sel0', 'sel1'],
	outputs: ['out'],
	evaluate: ([d0, d1, d2, d3, sel0, sel1]) => {
		if ((sel0 === 0 || sel0 === 1) && (sel1 === 0 || sel1 === 1)) {
			const data: LogicValue[] = [d0, d1, d2, d3];
			return { outputs: [data[(sel0 as number) | ((sel1 as number) << 1)]] };
		}
		return { outputs: ['X'] };
	}
};
