import { describe, expect, it } from 'vitest';

import { ApiError } from '../client';
import { teamErrorMessage } from '../teams';

describe('team error messages', () => {
	it('explains an unavailable member email without revealing whether it exists', () => {
		expect(teamErrorMessage(new ApiError(404, { error: 'member_not_available' }))).toBe(
			'That email cannot be added. Only verified CircuitGate accounts can join a team.'
		);
	});

	it('explains that the team owner cannot be removed', () => {
		expect(teamErrorMessage(new ApiError(409, { error: 'owner_cannot_be_removed' }))).toBe(
			'The team owner cannot be removed.'
		);
	});

	it('explains a missing or inaccessible team', () => {
		expect(teamErrorMessage(new ApiError(404, { error: 'not_found' }))).toBe('That team is no longer available.');
	});

	it('falls back to the shared message for other failures', () => {
		expect(teamErrorMessage(new ApiError(500, { error: 'internal_error' }))).toBe(
			'The request failed. Try again.'
		);
	});
});
