package dev.circuitgate.account;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds a verified default account so a fresh local database is usable
 * immediately. Active only under the local development profile; production
 * deployments never seed accounts. Override the credentials with
 * CIRCUITGATE_DEV_EMAIL / CIRCUITGATE_DEV_PASSWORD.
 */
@Component
@Profile("local")
public class DevAccountSeeder implements ApplicationRunner {

	public static final String DEFAULT_EMAIL = "dev@circuitgate.local";
	public static final String DEFAULT_PASSWORD = "circuitgate-dev";

	private final UserRepository users;
	private final PasswordEncoder passwordEncoder;

	public DevAccountSeeder(UserRepository users, PasswordEncoder passwordEncoder) {
		this.users = users;
		this.passwordEncoder = passwordEncoder;
	}

	@Override
	@Transactional
	public void run(ApplicationArguments args) {
		String email = environment("CIRCUITGATE_DEV_EMAIL", DEFAULT_EMAIL).toLowerCase(Locale.ROOT);
		String password = environment("CIRCUITGATE_DEV_PASSWORD", DEFAULT_PASSWORD);
		if (email.isEmpty() || password.isEmpty()) {
			return;
		}
		User existing = users.findByEmailIgnoreCase(email).orElse(null);
		if (existing != null) {
			if (!existing.isEmailVerified()) {
				existing.setEmailVerified(true);
				existing.setUpdatedAt(Instant.now());
			}
			return;
		}
		User user = new User(UUID.randomUUID(), email, passwordEncoder.encode(password), Instant.now());
		user.setEmailVerified(true);
		users.save(user);
	}

	private static String environment(String name, String fallback) {
		String value = System.getenv(name);
		return value == null || value.isBlank() ? fallback : value.trim();
	}
}
