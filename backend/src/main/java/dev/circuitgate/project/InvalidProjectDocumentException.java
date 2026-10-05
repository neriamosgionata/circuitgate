package dev.circuitgate.project;

public class InvalidProjectDocumentException extends RuntimeException {

	public InvalidProjectDocumentException() {
		super("Invalid project document");
	}
}
