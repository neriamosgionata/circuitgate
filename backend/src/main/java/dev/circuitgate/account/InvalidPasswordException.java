package dev.circuitgate.account;

public class InvalidPasswordException extends RuntimeException {

	public InvalidPasswordException() {
		super("The current password is not correct");
	}
}
