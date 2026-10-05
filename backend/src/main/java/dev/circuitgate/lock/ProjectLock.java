package dev.circuitgate.lock;

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
@Table(name = "project_locks")
public class ProjectLock {

	@Id
	@Column(name = "project_id", nullable = false, updatable = false)
	private UUID projectId;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "holder_id", nullable = false)
	private User holder;

	@Column(name = "epoch", nullable = false)
	private long epoch;

	@Column(name = "acquired_at", nullable = false)
	private Instant acquiredAt;

	@Column(name = "expires_at", nullable = false)
	private Instant expiresAt;

	@Column(name = "released_at")
	private Instant releasedAt;

	protected ProjectLock() {
	}

	public UUID getProjectId() {
		return projectId;
	}

	public User getHolder() {
		return holder;
	}

	public long getEpoch() {
		return epoch;
	}

	public Instant getAcquiredAt() {
		return acquiredAt;
	}

	public Instant getExpiresAt() {
		return expiresAt;
	}

	public Instant getReleasedAt() {
		return releasedAt;
	}
}
