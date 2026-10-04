package dev.circuitgate.lock;

import dev.circuitgate.lock.dto.LockDtos.LockStateResponse;

public class ProjectLockedException extends RuntimeException {

	private final transient LockStateResponse lock;

	public ProjectLockedException(LockStateResponse lock) {
		super("project is locked");
		this.lock = lock;
	}

	public LockStateResponse getLock() {
		return lock;
	}
}
