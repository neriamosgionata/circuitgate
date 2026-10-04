package dev.circuitgate.lock;

import java.time.Instant;
import java.util.UUID;

public record LockTransition(UUID projectId, UUID holderId, String holderEmail, long epoch, Instant expiresAt,
		String reason) {
}
