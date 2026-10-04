package dev.circuitgate.project;

public class ProjectConflictException extends RuntimeException {

	private final long currentVersion;

	public ProjectConflictException(long currentVersion) {
		super("Project content version conflict");
		this.currentVersion = currentVersion;
	}

	public long getCurrentVersion() {
		return currentVersion;
	}
}
