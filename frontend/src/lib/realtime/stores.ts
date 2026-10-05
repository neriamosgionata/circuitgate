export interface ProjectRealtimeEvent {
	type: string;
	projectId?: string;
	version?: number;
	epoch?: number;
	locked?: boolean;
	holderId?: string | null;
	holderEmail?: string | null;
	expiresAt?: string | null;
	reason?: string;
	[key: string]: unknown;
}

export interface ProjectRealtimeState {
	version: number;
	lockEpoch: number;
}

export function initialProjectRealtimeState(version: number, lockEpoch = 0): ProjectRealtimeState {
	return { version, lockEpoch };
}

export function reduceProjectEvent(
	state: ProjectRealtimeState,
	event: ProjectRealtimeEvent
): ProjectRealtimeState | null {
	switch (event.type) {
		case 'project_saved': {
			const version = typeof event.version === 'number' ? event.version : 0;
			if (version <= state.version) return null;
			return { ...state, version };
		}
		case 'lock_changed': {
			const epoch = typeof event.epoch === 'number' ? event.epoch : 0;
			if (epoch <= state.lockEpoch) return null;
			return { ...state, lockEpoch: epoch };
		}
		case 'project_deleted':
		case 'share_changed':
		case 'team_membership_changed':
			return state;
		default:
			return null;
	}
}
