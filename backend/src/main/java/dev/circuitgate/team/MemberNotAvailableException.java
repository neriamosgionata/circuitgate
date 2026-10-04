package dev.circuitgate.team;

public class MemberNotAvailableException extends RuntimeException {

	public MemberNotAvailableException() {
		super("No verified account is available for that email");
	}
}
