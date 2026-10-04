package dev.circuitgate.account;

import dev.circuitgate.config.CircuitGateProperties;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "circuitgate.mail.mode", havingValue = "smtp")
public class SmtpMailService implements MailService {

	private final JavaMailSender mailSender;

	private final CircuitGateProperties properties;

	public SmtpMailService(JavaMailSender mailSender, CircuitGateProperties properties) {
		this.mailSender = mailSender;
		this.properties = properties;
	}

	@Override
	public void sendVerificationEmail(String to, String token) {
		String link = properties.getApp().getBaseUrl() + "/verify?token=" + token;
		send(to, "Verify your CircuitGate account",
				"Confirm your email address to activate your CircuitGate account:\n" + link);
	}

	@Override
	public void sendPasswordResetEmail(String to, String token) {
		String link = properties.getApp().getBaseUrl() + "/reset?token=" + token;
		send(to, "Reset your CircuitGate password",
				"Choose a new CircuitGate password with this link:\n" + link);
	}

	@Override
	public void sendDuplicateRegistrationNotice(String to) {
		send(to, "CircuitGate registration attempt",
				"Someone tried to register with this address. If that was you, request a new verification email.");
	}

	private void send(String to, String subject, String body) {
		SimpleMailMessage message = new SimpleMailMessage();
		message.setFrom(properties.getMail().getFrom());
		message.setTo(to);
		message.setSubject(subject);
		message.setText(body);
		try {
			mailSender.send(message);
		}
		catch (MailException ex) {
			throw new SendMailException("Mail delivery failed", ex);
		}
	}
}
