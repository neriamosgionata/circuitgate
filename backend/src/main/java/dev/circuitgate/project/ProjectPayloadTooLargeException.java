package dev.circuitgate.project;

public class ProjectPayloadTooLargeException extends RuntimeException {

	public ProjectPayloadTooLargeException() {
		super("Project document exceeds the maximum size");
	}
}
