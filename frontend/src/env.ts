import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	CIRCUITGATE_API_ORIGIN: {
		description: 'Base URL of the CircuitGate backend API used by server-side loads.',
		schema: (value) => (value === undefined || value.length === 0 ? 'http://localhost:8080' : value)
	}
});
