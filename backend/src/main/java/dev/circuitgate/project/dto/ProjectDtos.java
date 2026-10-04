package dev.circuitgate.project.dto;

import java.time.Instant;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public final class ProjectDtos {

	private ProjectDtos() {
	}

	public record CreateProjectRequest(@NotBlank @Size(max = 200) String name, @NotNull Integer schemaVersion,
			@NotNull JsonNode document) {
	}

	public record SaveProjectRequest(@NotBlank @Size(max = 200) String name, @NotNull Integer schemaVersion,
			@Positive long version, @NotNull JsonNode document) {
	}

	public record ImportRequest(String format, String name, Integer schemaVersion, Long contentVersion,
			JsonNode document) {
	}

	public record ProjectResponse(UUID id, String name, int schemaVersion, long version, JsonNode document,
			Instant createdAt, Instant updatedAt) {
	}

	public record ProjectSummary(UUID id, String name, long version, Instant createdAt, Instant updatedAt) {
	}

	public record ExportEnvelope(String format, int schemaVersion, long contentVersion, String name,
			JsonNode document) {
	}
}
