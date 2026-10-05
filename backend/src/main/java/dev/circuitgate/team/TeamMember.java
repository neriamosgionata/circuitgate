package dev.circuitgate.team;

import java.time.Instant;

import dev.circuitgate.account.User;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapsId;
import jakarta.persistence.Table;

@Entity
@Table(name = "team_members")
public class TeamMember {

	@EmbeddedId
	private TeamMemberId id;

	@MapsId("teamId")
	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "team_id", nullable = false, updatable = false)
	private Team team;

	@MapsId("userId")
	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "user_id", nullable = false, updatable = false)
	private User user;

	@Column(name = "role", nullable = false, length = 16)
	private String role;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	protected TeamMember() {
	}

	public TeamMemberId getId() {
		return id;
	}

	public Team getTeam() {
		return team;
	}

	public User getUser() {
		return user;
	}

	public String getRole() {
		return role;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
