export interface QueueEntry {
	tick: number;
	index: number;
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
