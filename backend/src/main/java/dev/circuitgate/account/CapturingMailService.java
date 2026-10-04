package dev.circuitgate.account;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "circuitgate.mail.mode", havingValue = "capture", matchIfMissing = true)
public class CapturingMailService implements MailService {

	private final List<CapturedMail> messages = new CopyOnWriteArrayList<>();

	@Override
	public void sendVerificationEmail(String to, String token) {
		record(CapturedMail.Type.VERIFICATION, to, token, "Verify your CircuitGate account",
				"Confirm your email address to activate your CircuitGate account.");
	}

	@Override
	public void sendPasswordResetEmail(String to, String token) {
		record(CapturedMail.Type.PASSWORD_RESET, to, token, "Reset your CircuitGate password",
				"Use the link in this message to choose a new password.");
	}

	@Override
	public void sendDuplicateRegistrationNotice(String to) {
		record(CapturedMail.Type.DUPLICATE_REGISTRATION_NOTICE, to, null, "CircuitGate registration attempt",
				"Someone tried to register with this address. If that was you, request a new verification email.");
	}

	public List<CapturedMail> messages() {
		return List.copyOf(messages);
	}

	public List<CapturedMail> messagesTo(String to) {
		return messages.stream().filter(message -> message.to().equalsIgnoreCase(to)).toList();
	}

	public Optional<CapturedMail> latest(CapturedMail.Type type, String to) {
		return messages.stream()
			.filter(message -> message.type() == type && message.to().equalsIgnoreCase(to))
			.reduce((first, second) -> second);
	}

	public void clear() {
		messages.clear();
	}

	private void record(CapturedMail.Type type, String to, String token, String subject, String body) {
		messages.add(new CapturedMail(type, to, token, subject, body));
	}
}
