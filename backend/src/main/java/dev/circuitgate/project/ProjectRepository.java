package dev.circuitgate.project;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

	List<Project> findByOwnerIdOrderByUpdatedAtDesc(UUID ownerId);

	@Modifying(clearAutomatically = true)
	@Query("""
			update Project project
			   set project.name = :name,
			       project.document = :document,
			       project.schemaVersion = :schemaVersion,
			       project.contentVersion = project.contentVersion + 1,
			       project.updatedAt = :now
			 where project.id = :id
			   and project.owner.id = :ownerId
			   and project.contentVersion = :expectedVersion
			""")
	int saveIfVersionMatches(@Param("id") UUID id, @Param("ownerId") UUID ownerId, @Param("name") String name,
			@Param("document") JsonNode document, @Param("schemaVersion") int schemaVersion,
			@Param("expectedVersion") long expectedVersion, @Param("now") Instant now);

	@Modifying(clearAutomatically = true)
	@Query("delete from Project project where project.id = :id and project.owner.id = :ownerId")
	int deleteOwned(@Param("id") UUID id, @Param("ownerId") UUID ownerId);
}
