import type { Scheduler, WorkerLike } from '../session';

/**
 * Shared test harness for the transport sessions: a deterministic scheduler
 * plus a scriptable WorkerLike. Kept protocol-agnostic so the digital and
 * analog suites exercise the same stand-in worker.
 */
export class ManualScheduler {
	private callbacks = new Map<number, () => void>();
	private nextId = 0;

	readonly schedule: Scheduler = (callback) => {
		const id = this.nextId++;
		this.callbacks.set(id, callback);
		return () => {
			this.callbacks.delete(id);
		};
	};

	fireAll(): number {
		const pending = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of pending) callback();
		return pending.length;
	}

	drain(): void {
		for (let guard = 0; guard < 100 && this.callbacks.size > 0; guard++) this.fireAll();
	}

	get pending(): number {
		return this.callbacks.size;
	}
}

export class FakeWorker implements WorkerLike {
	private listeners = new Map<string, Array<(event: unknown) => void>>();
	readonly messages: unknown[] = [];
	terminated = false;

	postMessage(message: unknown): void {
		this.messages.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const list = this.listeners.get(type);
		if (list) list.push(listener);
		else this.listeners.set(type, [listener]);
	}

	emit(event: unknown): void {
		for (const listener of this.listeners.get('message') ?? []) listener({ data: event });
	}

	fail(message: string): void {
		for (const listener of this.listeners.get('error') ?? []) listener({ message });
	}

	messageError(): void {
		for (const listener of this.listeners.get('messageerror') ?? []) listener({});
	}

	get lastMessage(): unknown {
		return this.messages.at(-1);
	}
}
