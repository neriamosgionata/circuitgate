import { describe, expect, it } from 'vitest';

import {
	initialProjectRealtimeState,
	reduceProjectEvent,
	type ProjectRealtimeEvent
} from '../stores';

function event(partial: Partial<ProjectRealtimeEvent> & { type: string }): ProjectRealtimeEvent {
	return { projectId: 'p1', ...partial };
}

describe('project realtime reducer', () => {
	it('applies newer saves and ignores duplicates and stale versions', () => {
		const state = initialProjectRealtimeState(3);
		expect(reduceProjectEvent(state, event({ type: 'project_saved', version: 4 }))).toEqual({
			version: 4,
			lockEpoch: 0
		});
		expect(reduceProjectEvent(state, event({ type: 'project_saved', version: 3 }))).toBeNull();
		expect(reduceProjectEvent(state, event({ type: 'project_saved', version: 2 }))).toBeNull();
	});

	it('applies only newer lock epochs so out-of-order events cannot regress', () => {
		const state = initialProjectRealtimeState(1, 0);
		const afterFive = reduceProjectEvent(state, event({ type: 'lock_changed', epoch: 5 }));
		expect(afterFive).toEqual({ version: 1, lockEpoch: 5 });
		expect(reduceProjectEvent(afterFive!, event({ type: 'lock_changed', epoch: 5 }))).toBeNull();
		expect(reduceProjectEvent(afterFive!, event({ type: 'lock_changed', epoch: 3 }))).toBeNull();
		expect(reduceProjectEvent(afterFive!, event({ type: 'lock_changed', epoch: 6 }))).toEqual({
			version: 1,
			lockEpoch: 6
		});
	});

	it('signals refetch-worthy events without advancing the counters', () => {
		const state = initialProjectRealtimeState(7, 2);
		for (const type of ['share_changed', 'team_membership_changed', 'project_deleted']) {
			expect(reduceProjectEvent(state, event({ type }))).toEqual(state);
		}
	});

	it('ignores unknown event types and malformed epochs', () => {
		const state = initialProjectRealtimeState(1, 1);
		expect(reduceProjectEvent(state, event({ type: 'nonsense' }))).toBeNull();
		expect(reduceProjectEvent(state, event({ type: 'lock_changed' }))).toBeNull();
		expect(reduceProjectEvent(state, event({ type: 'project_saved' }))).toBeNull();
	});
});
