package dev.circuitgate.account;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

import dev.circuitgate.config.CircuitGateProperties;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TokenService {

	private static final SecureRandom RANDOM = new SecureRandom();

	private static final int TOKEN_BYTES = 32;

	private final AuthTokenRepository tokens;

	private final CircuitGateProperties properties;

	private final Clock clock;

	public TokenService(AuthTokenRepository tokens, CircuitGateProperties properties, Clock clock) {
		this.tokens = tokens;
		this.properties = properties;
		this.clock = clock;
	}

	@Transactional
	public IssuedToken issue(User user, TokenType type, Duration ttl) {
		Instant now = clock.instant();
		tokens.consumeAllForUser(user.getId(), type, now);
		String rawToken = generateToken();
		AuthToken token = tokens
			.save(new AuthToken(user, type, hash(rawToken), now, now.plus(ttl)));
		return new IssuedToken(rawToken, token);
	}

	@Transactional
	public Optional<AuthToken> consume(String rawToken, TokenType type) {
		if (rawToken == null || rawToken.isBlank()) {
			return Optional.empty();
		}
		Instant now = clock.instant();
		String hash = hash(rawToken);
		if (tokens.consumeByHash(hash, type, now) != 1) {
			return Optional.empty();
		}
		return tokens.findByTokenHash(hash);
	}

	@Transactional
	public void consumeAllForUser(UUID userId) {
		tokens.consumeAllForUser(userId, clock.instant());
	}

	public String hash(String rawToken) {
		return TokenHasher.sha256Hex(rawToken);
	}

	@Scheduled(cron = "${circuitgate.tokens.cleanup-cron:0 30 3 * * *}")
	@Transactional
	public void purgeStaleTokens() {
		Instant now = clock.instant();
		tokens.deleteStale(now, now.minus(Duration.ofDays(1)));
	}

	private String generateToken() {
		byte[] bytes = new byte[TOKEN_BYTES];
		RANDOM.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	public record IssuedToken(String raw, AuthToken token) {
	}
}
