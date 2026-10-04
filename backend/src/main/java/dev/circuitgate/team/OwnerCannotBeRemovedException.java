package dev.circuitgate.team;

public class OwnerCannotBeRemovedException extends RuntimeException {

	public OwnerCannotBeRemovedException() {
		super("The team owner cannot be removed");
	}
}
