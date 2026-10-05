package dev.circuitgate.sharing;

import java.time.Instant;

import dev.circuitgate.account.User;
import dev.circuitgate.project.Project;
import dev.circuitgate.team.Team;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapsId;
import jakarta.persistence.Table;

@Entity
@Table(name = "project_teams")
public class ProjectTeam {

	@EmbeddedId
	private ProjectTeamId id;

	@MapsId("projectId")
	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "project_id", nullable = false, updatable = false)
	private Project project;

	@MapsId("teamId")
	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "team_id", nullable = false, updatable = false)
	private Team team;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "created_by", nullable = false, updatable = false)
	private User createdBy;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	protected ProjectTeam() {
	}

	public ProjectTeam(Project project, Team team, User createdBy, Instant now) {
		this.id = new ProjectTeamId(project.getId(), team.getId());
		this.project = project;
		this.team = team;
		this.createdBy = createdBy;
		this.createdAt = now;
	}

	public ProjectTeamId getId() {
		return id;
	}

	public Project getProject() {
		return project;
	}

	public Team getTeam() {
		return team;
	}

	public User getCreatedBy() {
		return createdBy;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
