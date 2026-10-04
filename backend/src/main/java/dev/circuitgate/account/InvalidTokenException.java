package dev.circuitgate.account;

public class InvalidTokenException extends RuntimeException {

	public InvalidTokenException() {
		super("The token is invalid, expired, or already used");
	}
}
