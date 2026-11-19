import { isSimulationCommand } from '../lib/sim/protocol';
import { SimulationHost } from '../lib/sim/session';

const scope = self as unknown as {
	postMessage: (message: unknown) => void;
	onmessage: ((event: MessageEvent) => void) | null;
};

// Flush coalesced value updates in a microtask: the worker already batches
// per commit, and waiting for a timer would add up to a frame of latency to
// every interactive toggle. The physical Run loop yields on a macrotask so
// Pause and mode commands can reach the worker between timestamps.
const host = new SimulationHost(
	(event) => {
		scope.postMessage(event);
	},
	{
		schedule: (callback) => {
			queueMicrotask(callback);
			return () => {};
		},
		runSchedule: (callback) => {
			const handle = setTimeout(callback, 0);
			return () => clearTimeout(handle);
		}
	}
);

scope.onmessage = (event: MessageEvent) => {
	if (isSimulationCommand(event.data)) host.handle(event.data);
};
