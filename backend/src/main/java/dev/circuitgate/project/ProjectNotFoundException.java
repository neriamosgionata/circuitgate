package dev.circuitgate.project;

public class ProjectNotFoundException extends RuntimeException {

	public ProjectNotFoundException() {
		super("Project not found");
	}
}
