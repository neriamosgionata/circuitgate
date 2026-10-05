package dev.circuitgate.project;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

	List<Project> findByOwnerIdOrderByUpdatedAtDesc(UUID ownerId);

	@Query(value = """
			select distinct p.* from projects p
			  join project_teams pt on pt.project_id = p.id
			  join team_members tm on tm.team_id = pt.team_id
			 where tm.user_id = :userId
			 order by p.updated_at desc
			""", nativeQuery = true)
	List<Project> findSharedWith(@Param("userId") UUID userId);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = """
			update projects p
			   set name = :name,
			       document = cast(:document as jsonb),
			       schema_version = :schemaVersion,
			       content_version = p.content_version + 1,
			       updated_at = now()
			 where p.id = :id
			   and p.content_version = :expectedVersion
			   and (p.owner_id = :userId
			        or exists (select 1 from project_teams pt
			                     join team_members tm on tm.team_id = pt.team_id
			                    where pt.project_id = p.id
			                      and tm.user_id = :userId))
			   and (not exists (select 1 from project_teams pt where pt.project_id = p.id)
			        or exists (select 1 from project_locks l
			                    where l.project_id = p.id
			                      and l.holder_id = :userId
			                      and l.released_at is null
			                      and l.expires_at > now()
			                      and (cast(:lockEpoch as bigint) is null
			                           or l.epoch = cast(:lockEpoch as bigint))))
			""", nativeQuery = true)
	int saveIfVersionMatchesForEditor(@Param("id") UUID id, @Param("userId") UUID userId, @Param("name") String name,
			@Param("document") String document, @Param("schemaVersion") int schemaVersion,
			@Param("expectedVersion") long expectedVersion, @Param("lockEpoch") Long lockEpoch);

	@Modifying(clearAutomatically = true)
	@Query("delete from Project project where project.id = :id and project.owner.id = :ownerId")
	int deleteOwned(@Param("id") UUID id, @Param("ownerId") UUID ownerId);
}
