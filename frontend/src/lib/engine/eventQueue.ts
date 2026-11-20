export interface QueueEntry {
	tick: number;
	index: number;
}

export type PhysicalTaskKind = 'transition' | 'evaluate' | 'commit';

export interface PhysicalTask {
	timePs: number;
	sequence: number;
	kind: PhysicalTaskKind;
	componentIndex: number;
	pin?: number;
	value?: import('./values').LogicValue;
}

/**
 * Physical-mode task queue. Unlike the timed queue, it never deduplicates:
 * distinct transitions at the same timestamp are legitimate transport events.
 */
export class PhysicalTaskQueue {
	private heap: PhysicalTask[] = [];

	private static less(a: PhysicalTask, b: PhysicalTask): boolean {
		if (a.timePs !== b.timePs) return a.timePs < b.timePs;
		return a.sequence < b.sequence;
	}

	get size(): number {
		return this.heap.length;
	}

	push(task: PhysicalTask): void {
		this.heap.push(task);
		let child = this.heap.length - 1;
		while (child > 0) {
			const parent = (child - 1) >> 1;
			if (PhysicalTaskQueue.less(this.heap[child], this.heap[parent])) {
				[this.heap[child], this.heap[parent]] = [this.heap[parent], this.heap[child]];
				child = parent;
			} else {
				break;
			}
		}
	}

	peek(): PhysicalTask | undefined {
		return this.heap[0];
	}

	pop(): PhysicalTask | undefined {
		if (this.heap.length === 0) return undefined;
		const top = this.heap[0];
		const last = this.heap.pop() as PhysicalTask;
		if (this.heap.length > 0) {
			this.heap[0] = last;
			let parent = 0;
			for (;;) {
				const left = parent * 2 + 1;
				const right = left + 1;
				let smallest = parent;
				if (left < this.heap.length && PhysicalTaskQueue.less(this.heap[left], this.heap[smallest])) {
					smallest = left;
				}
				if (
					right < this.heap.length &&
					PhysicalTaskQueue.less(this.heap[right], this.heap[smallest])
				) {
					smallest = right;
				}
				if (smallest === parent) break;
				[this.heap[parent], this.heap[smallest]] = [this.heap[smallest], this.heap[parent]];
				parent = smallest;
			}
		}
		return top;
	}

	/** Remove and return every task due at exactly `timePs`, in sequence order. */
	due(timePs: number): PhysicalTask[] {
		const tasks: PhysicalTask[] = [];
		while (this.heap.length > 0 && (this.heap[0] as PhysicalTask).timePs === timePs) {
			tasks.push(this.pop() as PhysicalTask);
		}
		return tasks;
	}
}

export class EventQueue {
	private heap: QueueEntry[] = [];
	private present = new Set<string>();

	private key(tick: number, index: number): string {
		return `${tick}:${index}`;
	}

	private static less(a: QueueEntry, b: QueueEntry): boolean {
		if (a.tick !== b.tick) return a.tick < b.tick;
		return a.index < b.index;
	}

	get size(): number {
		return this.heap.length;
	}

	has(tick: number, index: number): boolean {
		return this.present.has(this.key(tick, index));
	}

	push(tick: number, index: number): void {
		if (this.has(tick, index)) return;
		const entry: QueueEntry = { tick, index };
		this.present.add(this.key(tick, index));
		this.heap.push(entry);
		let child = this.heap.length - 1;
		while (child > 0) {
			const parent = (child - 1) >> 1;
			if (EventQueue.less(this.heap[child], this.heap[parent])) {
				[this.heap[child], this.heap[parent]] = [this.heap[parent], this.heap[child]];
				child = parent;
			} else {
				break;
			}
		}
	}

	peek(): QueueEntry | undefined {
		return this.heap[0];
	}

	pop(): QueueEntry | undefined {
		if (this.heap.length === 0) return undefined;
		const top = this.heap[0];
		const last = this.heap.pop() as QueueEntry;
		this.present.delete(this.key(top.tick, top.index));
		if (this.heap.length > 0) {
			this.heap[0] = last;
			let parent = 0;
			for (;;) {
				const left = parent * 2 + 1;
				const right = left + 1;
				let smallest = parent;
				if (left < this.heap.length && EventQueue.less(this.heap[left], this.heap[smallest])) {
					smallest = left;
				}
				if (right < this.heap.length && EventQueue.less(this.heap[right], this.heap[smallest])) {
					smallest = right;
				}
				if (smallest === parent) break;
				[this.heap[parent], this.heap[smallest]] = [this.heap[smallest], this.heap[parent]];
				parent = smallest;
			}
		}
		return top;
	}
}
