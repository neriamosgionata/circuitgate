package dev.circuitgate.account;

public interface MailService {

	void sendVerificationEmail(String to, String token);

	void sendPasswordResetEmail(String to, String token);

	void sendDuplicateRegistrationNotice(String to);
}
