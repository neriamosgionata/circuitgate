import { isSimulationCommand } from '../lib/sim/protocol';
import { SimulationHost } from '../lib/sim/session';

const scope = self as unknown as {
	postMessage: (message: unknown) => void;
	onmessage: ((event: MessageEvent) => void) | null;
};

const host = new SimulationHost((event) => {
	scope.postMessage(event);
});

scope.onmessage = (event: MessageEvent) => {
	if (isSimulationCommand(event.data)) host.handle(event.data);
};
