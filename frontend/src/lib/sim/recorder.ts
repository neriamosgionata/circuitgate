import type { LogicValue } from '../engine/values';

export interface WaveformChange {
	tick: number;
	value: LogicValue;
	oscillating: boolean;
}

export interface RecorderOptions {
	retentionPerNet?: number;
}

export const DEFAULT_RETENTION_PER_NET = 4096;

const VALID_VALUES: ReadonlySet<LogicValue> = new Set([0, 1, 'X', 'Z']);

export function changeIndexAt(changes: readonly WaveformChange[], tick: number): number {
	if (changes.length === 0 || tick < changes[0].tick) return -1;
	let low = 0;
	let high = changes.length - 1;
	let result = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (changes[middle].tick <= tick) {
			result = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return result;
}

// Per-net change lists with a retention cap. When a list overflows, the oldest
// changes are dropped and an anchor entry preserves the value the net held at
// the new window start, so binary search stays correct for retained ticks.
export class WaveformRecorder {
	readonly retentionPerNet: number;
	private histories = new Map<string, WaveformChange[]>();
	private changes = 0;
	private latestTick = -1;

	constructor(options: RecorderOptions = {}) {
		const retention = options.retentionPerNet ?? DEFAULT_RETENTION_PER_NET;
		if (!Number.isInteger(retention) || retention < 1) {
			throw new Error(`retentionPerNet must be a positive integer, got ${retention}`);
		}
		this.retentionPerNet = retention;
	}

	get changeCount(): number {
		return this.changes;
	}

	get netCount(): number {
		return this.histories.size;
	}

	nets(): string[] {
		return [...this.histories.keys()];
	}

	history(net: string): readonly WaveformChange[] {
		return this.histories.get(net) ?? [];
	}

	firstTick(net: string): number | undefined {
		return this.histories.get(net)?.[0]?.tick;
	}

	lastTick(): number {
		return this.latestTick;
	}

	valueAt(net: string, tick: number): LogicValue | undefined {
		const list = this.histories.get(net);
		if (!list) return undefined;
		const index = changeIndexAt(list, tick);
		return index === -1 ? undefined : list[index].value;
	}

	record(tick: number, net: string, value: LogicValue, oscillating = false): boolean {
		if (!Number.isInteger(tick) || tick < 0) {
			throw new Error(`tick must be a non-negative integer, got ${tick}`);
		}
		if (net.length === 0) {
			throw new Error('net id must not be empty');
		}
		if (!VALID_VALUES.has(value)) {
			throw new Error(`invalid logic value: ${String(value)}`);
		}
		let list = this.histories.get(net);
		if (!list) {
			list = [];
			this.histories.set(net, list);
		}
		const last = list[list.length - 1];
		if (last) {
			if (tick < last.tick) {
				throw new Error(`tick ${tick} precedes last recorded tick ${last.tick} for net ${net}`);
			}
			if (last.value === value && last.oscillating === oscillating) return false;
		}
		list.push({ tick, value, oscillating });
		this.changes += 1;
		if (tick > this.latestTick) this.latestTick = tick;
		if (list.length > this.retentionPerNet) {
			const drop = list.length - this.retentionPerNet + 1;
			const anchor = list[drop - 1];
			const kept = list.slice(drop);
			kept.unshift({ ...anchor });
			this.histories.set(net, kept);
			this.changes -= list.length - kept.length;
		}
		return true;
	}

	clear(): void {
		this.histories = new Map();
		this.changes = 0;
		this.latestTick = -1;
	}
}
