package dev.circuitgate.sharing.dto;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotNull;

public final class SharingDtos {

	private SharingDtos() {
	}

	public record CreateShareRequest(@NotNull UUID teamId) {
	}

	public record ShareResponse(UUID projectId, UUID teamId, String teamName, Instant createdAt) {
	}
}
