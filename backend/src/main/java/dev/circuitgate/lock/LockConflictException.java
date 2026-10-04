package dev.circuitgate.lock;

public class LockConflictException extends RuntimeException {

	private final String reason;

	private final Long version;

	public LockConflictException(String reason) {
		this(reason, null);
	}

	public LockConflictException(String reason, Long version) {
		super("lock conflict: " + reason);
		this.reason = reason;
		this.version = version;
	}

	public String getReason() {
		return reason;
	}

	public Long getVersion() {
		return version;
	}
}
