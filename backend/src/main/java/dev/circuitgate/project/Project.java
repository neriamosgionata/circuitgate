package dev.circuitgate.project;

import java.time.Instant;
import java.util.UUID;

import dev.circuitgate.account.User;

import tools.jackson.databind.JsonNode;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "projects")
public class Project {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "owner_id", nullable = false, updatable = false)
	private User owner;

	@Column(name = "name", nullable = false, length = 200)
	private String name;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "document", nullable = false, columnDefinition = "jsonb")
	private JsonNode document;

	@Column(name = "schema_version", nullable = false)
	private int schemaVersion;

	@Column(name = "content_version", nullable = false)
	private long contentVersion;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	protected Project() {
	}

	public Project(UUID id, User owner, String name, int schemaVersion, JsonNode document, Instant now) {
		this.id = id;
		this.owner = owner;
		this.name = name;
		this.document = document;
		this.schemaVersion = schemaVersion;
		this.contentVersion = 1;
		this.createdAt = now;
		this.updatedAt = now;
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

	public JsonNode getDocument() {
		return document;
	}

	public int getSchemaVersion() {
		return schemaVersion;
	}

	public long getContentVersion() {
		return contentVersion;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
