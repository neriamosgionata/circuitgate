package dev.circuitgate.account;

public record CapturedMail(Type type, String to, String token, String subject, String body) {

	public enum Type {
		VERIFICATION, PASSWORD_RESET, DUPLICATE_REGISTRATION_NOTICE
	}
}
