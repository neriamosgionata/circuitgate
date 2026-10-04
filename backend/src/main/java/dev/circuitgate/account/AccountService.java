package dev.circuitgate.account;

import java.time.Clock;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import dev.circuitgate.config.CircuitGateProperties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AccountService {

	private static final Logger log = LoggerFactory.getLogger(AccountService.class);

	private final UserRepository users;

	private final TokenService tokens;

	private final MailService mail;

	private final PasswordEncoder passwordEncoder;

	private final ThrottlingService throttling;

	private final FindByIndexNameSessionRepository<? extends Session> sessions;

	private final JdbcTemplate jdbc;

	private final CircuitGateProperties properties;

	private final TransactionTemplate transactions;

	private final Clock clock;

	public AccountService(UserRepository users, TokenService tokens, MailService mail, PasswordEncoder passwordEncoder,
			ThrottlingService throttling, FindByIndexNameSessionRepository<? extends Session> sessions,
			JdbcTemplate jdbc, CircuitGateProperties properties, TransactionTemplate transactions, Clock clock) {
		this.users = users;
		this.tokens = tokens;
		this.mail = mail;
		this.passwordEncoder = passwordEncoder;
		this.throttling = throttling;
		this.sessions = sessions;
		this.jdbc = jdbc;
		this.properties = properties;
		this.transactions = transactions;
		this.clock = clock;
	}

	public void register(String rawEmail, String password) {
		String email = normalize(rawEmail);
		String verificationToken = transactions.execute(status -> {
			if (users.findByEmail(email).isPresent()) {
				return null;
			}
			User user = users.save(new User(UUID.randomUUID(), email, passwordEncoder.encode(password), clock.instant()));
			return tokens.issue(user, TokenType.EMAIL_VERIFICATION, properties.getTokens().getVerificationTtl()).raw();
		});
		if (verificationToken == null) {
			mail.sendDuplicateRegistrationNotice(email);
		}
		else {
			mail.sendVerificationEmail(email, verificationToken);
		}
	}

	public void resendVerification(String rawEmail, String source) {
		String email = normalize(rawEmail);
		if (!throttling.tryAcquire("RESEND_VERIFICATION", email, source, properties.getTokens().getResendMax(),
				properties.getTokens().getResendWindow())) {
			throw new RateLimitedException();
		}
		String verificationToken = transactions.execute(status -> users.findByEmail(email)
			.filter(user -> !user.isEmailVerified())
			.map(user -> tokens.issue(user, TokenType.EMAIL_VERIFICATION, properties.getTokens().getVerificationTtl())
				.raw())
			.orElse(null));
		if (verificationToken != null) {
			mail.sendVerificationEmail(email, verificationToken);
		}
	}

	public void verifyEmail(String rawToken) {
		transactions.executeWithoutResult(status -> {
			AuthToken token = tokens.consume(rawToken, TokenType.EMAIL_VERIFICATION)
				.orElseThrow(InvalidTokenException::new);
			User user = token.getUser();
			if (!user.isEmailVerified()) {
				user.setEmailVerified(true);
				user.setUpdatedAt(clock.instant());
			}
		});
	}

	public void requestPasswordReset(String rawEmail, String source) {
		String email = normalize(rawEmail);
		if (!throttling.tryAcquire("RESET_REQUEST", email, source, properties.getTokens().getResetRequestMax(),
				properties.getTokens().getResetRequestWindow())) {
			throw new RateLimitedException();
		}
		String resetToken = transactions.execute(status -> {
			Optional<User> user = users.findByEmail(email);
			if (user.isEmpty()) {
				tokens.hash(UUID.randomUUID().toString());
				return null;
			}
			return tokens.issue(user.get(), TokenType.PASSWORD_RESET, properties.getTokens().getResetTtl()).raw();
		});
		if (resetToken != null) {
			try {
				mail.sendPasswordResetEmail(email, resetToken);
			}
			catch (SendMailException ex) {
				log.warn("Password reset email delivery failed for {}: {}", email, ex.getMessage());
			}
		}
	}

	public void resetPassword(String rawToken, String newPassword) {
		String email = transactions.execute(status -> {
			AuthToken token = tokens.consume(rawToken, TokenType.PASSWORD_RESET)
				.orElseThrow(InvalidTokenException::new);
			User user = token.getUser();
			user.setPasswordHash(passwordEncoder.encode(newPassword));
			user.setUpdatedAt(clock.instant());
			tokens.consumeAllForUser(user.getId());
			jdbc.update("delete from persistent_logins where username = ?", user.getEmail());
			return user.getEmail();
		});
		revokeSessions(email);
	}

	public void changePassword(String rawEmail, String currentPassword, String newPassword, String currentSessionId) {
		String email = normalize(rawEmail);
		transactions.executeWithoutResult(status -> {
			User user = users.findByEmail(email).orElseThrow(InvalidPasswordException::new);
			if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
				throw new InvalidPasswordException();
			}
			user.setPasswordHash(passwordEncoder.encode(newPassword));
			user.setUpdatedAt(clock.instant());
			jdbc.update("delete from persistent_logins where username = ?", email);
		});
		for (String sessionId : sessions.findByPrincipalName(email).keySet()) {
			if (!sessionId.equals(currentSessionId)) {
				sessions.deleteById(sessionId);
			}
		}
	}

	public void revokeSessions(String rawEmail) {
		String email = normalize(rawEmail);
		for (String sessionId : sessions.findByPrincipalName(email).keySet()) {
			sessions.deleteById(sessionId);
		}
	}

	public Profile getProfile(String rawEmail) {
		String email = normalize(rawEmail);
		User user = users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the authenticated principal"));
		return new Profile(user.getId(), user.getEmail(), user.isEmailVerified());
	}

	private String normalize(String email) {
		return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
	}

	public record Profile(UUID id, String email, boolean emailVerified) {
	}
}
