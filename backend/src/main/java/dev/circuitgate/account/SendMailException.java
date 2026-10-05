package dev.circuitgate.account;

public class SendMailException extends RuntimeException {

	public SendMailException(String message) {
		super(message);
	}

	public SendMailException(String message, Throwable cause) {
		super(message, cause);
	}
}
