import { ApiError, apiFetch } from './client';

export interface LockState {
	projectId: string;
	locked: boolean;
	holder: boolean;
	holderId: string | null;
	holderEmail: string | null;
	epoch: number;
	acquiredAt: string | null;
	expiresAt: string | null;
	ttlSeconds: number;
	heartbeatSeconds: number;
}

export function isLockBusy(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status === 409 && error.body.error === 'locked';
}

export function isLockConflict(error: unknown): error is ApiError {
	return error instanceof ApiError && error.status === 409 && error.body.error === 'lock_conflict';
}

export function lockStateFromError(error: ApiError): LockState | null {
	const lock = error.body['lock'];
	if (lock === null || typeof lock !== 'object') return null;
	return lock as LockState;
}

export async function getLockState(projectId: string): Promise<LockState> {
	return apiFetch<LockState>(`/api/projects/${encodeURIComponent(projectId)}/lock`);
}

export async function acquireLock(projectId: string): Promise<LockState> {
	return apiFetch<LockState>(`/api/projects/${encodeURIComponent(projectId)}/lock`, { method: 'POST' });
}

export async function heartbeatLock(projectId: string, epoch: number): Promise<LockState> {
	return apiFetch<LockState>(`/api/projects/${encodeURIComponent(projectId)}/lock/heartbeat`, {
		method: 'POST',
		body: { epoch }
	});
}

export async function releaseLock(
	projectId: string,
	epoch: number,
	options: { keepalive?: boolean } = {}
): Promise<void> {
	await apiFetch<void>(`/api/projects/${encodeURIComponent(projectId)}/lock`, {
		method: 'DELETE',
		body: { epoch },
		keepalive: options.keepalive ?? false
	});
}

export function lockErrorMessage(error: unknown): string {
	if (isLockBusy(error)) {
		return 'Another editor holds the lock. You are read-only until they release it.';
	}
	if (isLockConflict(error)) {
		const reason = error.body['reason'];
		if (reason === 'lock_expired') {
			return 'Your edit lock expired, so the save was refused. Your draft is kept.';
		}
		return 'Your edit lock is no longer valid. Your draft is kept.';
	}
	return 'The lock request failed. Try again.';
}
