export type LogicValue = 0 | 1 | 'X' | 'Z';

function asGateInput(value: LogicValue): LogicValue {
	return value === 'Z' ? 'X' : value;
}

export function and(a: LogicValue, b: LogicValue): LogicValue {
	const left = asGateInput(a);
	const right = asGateInput(b);
	if (left === 0 || right === 0) return 0;
	if (left === 1 && right === 1) return 1;
	return 'X';
}

export function or(a: LogicValue, b: LogicValue): LogicValue {
	const left = asGateInput(a);
	const right = asGateInput(b);
	if (left === 1 || right === 1) return 1;
	if (left === 0 && right === 0) return 0;
	return 'X';
}

export function not(a: LogicValue): LogicValue {
	const value = asGateInput(a);
	if (value === 0) return 1;
	if (value === 1) return 0;
	return 'X';
}

export function xor(a: LogicValue, b: LogicValue): LogicValue {
	const left = asGateInput(a);
	const right = asGateInput(b);
	if ((left === 0 || left === 1) && (right === 0 || right === 1)) {
		return ((left as number) ^ (right as number)) as LogicValue;
	}
	return 'X';
}

export function resolveDrivers(drivers: readonly LogicValue[]): LogicValue {
	let known: 0 | 1 | undefined;
	for (const driver of drivers) {
		if (driver === 'Z') continue;
		if (driver === 'X') return 'X';
		if (known === undefined) {
			known = driver;
		} else if (known !== driver) {
			return 'X';
		}
	}
	return known ?? 'Z';
}
