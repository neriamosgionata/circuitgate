import { apiFetch } from './client';

export interface ProjectShare {
	projectId: string;
	teamId: string;
	teamName: string;
	createdAt: string;
}

export async function listShares(projectId: string): Promise<ProjectShare[]> {
	return apiFetch<ProjectShare[]>(`/api/projects/${encodeURIComponent(projectId)}/shares`);
}

export async function shareProject(projectId: string, teamId: string): Promise<ProjectShare> {
	return apiFetch<ProjectShare>(`/api/projects/${encodeURIComponent(projectId)}/shares`, {
		method: 'POST',
		body: { teamId }
	});
}

export async function unshareProject(projectId: string, teamId: string): Promise<void> {
	await apiFetch<void>(
		`/api/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(teamId)}`,
		{ method: 'DELETE' }
	);
}
