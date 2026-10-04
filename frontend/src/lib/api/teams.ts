import { ApiError, apiErrorMessage, apiFetch } from './client';

export type TeamRole = 'owner' | 'member';

export interface TeamSummary {
	id: string;
	name: string;
	role: TeamRole;
	ownerId: string;
	createdAt: string;
}

export interface TeamMember {
	userId: string;
	email: string;
	role: TeamRole;
	createdAt: string;
}

export interface TeamDetail extends TeamSummary {
	members: TeamMember[];
}

export async function listTeams(): Promise<TeamSummary[]> {
	return apiFetch<TeamSummary[]>('/api/teams');
}

export async function createTeam(name: string): Promise<TeamDetail> {
	return apiFetch<TeamDetail>('/api/teams', { method: 'POST', body: { name } });
}

export async function getTeam(id: string): Promise<TeamDetail> {
	return apiFetch<TeamDetail>(`/api/teams/${encodeURIComponent(id)}`);
}

export async function addTeamMember(id: string, email: string): Promise<TeamMember> {
	return apiFetch<TeamMember>(`/api/teams/${encodeURIComponent(id)}/members`, {
		method: 'POST',
		body: { email }
	});
}

export async function removeTeamMember(id: string, userId: string): Promise<void> {
	await apiFetch<void>(`/api/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
		method: 'DELETE'
	});
}

export function teamErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		switch (error.body.error) {
			case 'member_not_available':
				return 'That email cannot be added. Only verified CircuitGate accounts can join a team.';
			case 'owner_cannot_be_removed':
				return 'The team owner cannot be removed.';
			case 'not_found':
				return 'That team is no longer available.';
			case 'invalid_request':
				return 'Check the details you entered and try again.';
			default:
				break;
		}
	}
	return apiErrorMessage(error);
}
