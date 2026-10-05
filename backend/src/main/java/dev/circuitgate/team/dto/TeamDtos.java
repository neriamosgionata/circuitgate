package dev.circuitgate.team.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class TeamDtos {

	private TeamDtos() {
	}

	public record CreateTeamRequest(@NotBlank @Size(max = 200) String name) {
	}

	public record AddTeamMemberRequest(@NotBlank @Email @Size(max = 320) String email) {
	}

	public record TeamSummary(UUID id, String name, String role, UUID ownerId, Instant createdAt) {
	}

	public record TeamMemberResponse(UUID userId, String email, String role, Instant createdAt) {
	}

	public record TeamDetailResponse(UUID id, String name, String role, UUID ownerId, Instant createdAt,
			List<TeamMemberResponse> members) {
	}
}
