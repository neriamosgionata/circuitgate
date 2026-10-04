package dev.circuitgate.lock.dto;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.Positive;

public final class LockDtos {

	private LockDtos() {
	}

	public record HeartbeatRequest(@Positive long epoch) {
	}

	public record ReleaseRequest(@Positive long epoch) {
	}

	public record LockStateResponse(UUID projectId, boolean locked, boolean holder, UUID holderId, String holderEmail,
			long epoch, Instant acquiredAt, Instant expiresAt, long ttlSeconds, long heartbeatSeconds) {
	}
}
