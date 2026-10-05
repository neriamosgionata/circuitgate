package dev.circuitgate.sharing;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

@Embeddable
public class ProjectTeamId implements Serializable {

	@Column(name = "project_id", nullable = false)
	private UUID projectId;

	@Column(name = "team_id", nullable = false)
	private UUID teamId;

	protected ProjectTeamId() {
	}

	public ProjectTeamId(UUID projectId, UUID teamId) {
		this.projectId = projectId;
		this.teamId = teamId;
	}

	public UUID getProjectId() {
		return projectId;
	}

	public UUID getTeamId() {
		return teamId;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof ProjectTeamId that)) {
			return false;
		}
		return Objects.equals(projectId, that.projectId) && Objects.equals(teamId, that.teamId);
	}

	@Override
	public int hashCode() {
		return Objects.hash(projectId, teamId);
	}
}
