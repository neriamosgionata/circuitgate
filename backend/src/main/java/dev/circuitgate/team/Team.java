package dev.circuitgate.team;

import java.time.Instant;
import java.util.UUID;

import dev.circuitgate.account.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "teams")
public class Team {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "owner_id", nullable = false, updatable = false)
	private User owner;

	@Column(name = "name", nullable = false, length = 200)
	private String name;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	protected Team() {
	}

	public Team(UUID id, User owner, String name, Instant now) {
		this.id = id;
		this.owner = owner;
		this.name = name;
		this.createdAt = now;
	}

	public UUID getId() {
		return id;
	}

	public User getOwner() {
		return owner;
	}

	public String getName() {
		return name;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}
}
