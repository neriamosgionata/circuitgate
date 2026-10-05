package dev.circuitgate.team;

public class TeamNotFoundException extends RuntimeException {

	public TeamNotFoundException() {
		super("Team not found");
	}
}
