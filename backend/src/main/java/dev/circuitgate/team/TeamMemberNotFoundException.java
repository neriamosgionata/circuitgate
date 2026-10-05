package dev.circuitgate.team;

public class TeamMemberNotFoundException extends RuntimeException {

	public TeamMemberNotFoundException() {
		super("Team member not found");
	}
}
