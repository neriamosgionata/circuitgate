package dev.circuitgate.lock;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectLockRepository extends JpaRepository<ProjectLock, UUID> {

	@Query("select lock from ProjectLock lock join fetch lock.holder where lock.projectId = :projectId")
	Optional<ProjectLock> findByProjectIdWithHolder(@Param("projectId") UUID projectId);

	@Query(value = """
			select (l.released_at is null and l.expires_at > now())
			  from project_locks l
			 where l.project_id = :projectId
			""", nativeQuery = true)
	Boolean isActiveNow(@Param("projectId") UUID projectId);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = """
			insert into project_locks (project_id, holder_id, epoch, acquired_at, expires_at, released_at)
			values (:projectId, :holderId, 1, now(), now() + make_interval(secs => :ttlSeconds), null)
			on conflict (project_id) do update
			   set holder_id = excluded.holder_id,
			       epoch = project_locks.epoch + 1,
			       acquired_at = now(),
			       expires_at = now() + make_interval(secs => :ttlSeconds),
			       released_at = null
			 where project_locks.released_at is not null
			    or project_locks.expires_at <= now()
			""", nativeQuery = true)
	int acquire(@Param("projectId") UUID projectId, @Param("holderId") UUID holderId,
			@Param("ttlSeconds") long ttlSeconds);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = """
			update project_locks l
			   set expires_at = now() + make_interval(secs => :ttlSeconds)
			 where l.project_id = :projectId
			   and l.holder_id = :holderId
			   and l.released_at is null
			   and l.expires_at > now()
			   and l.epoch = :epoch
			""", nativeQuery = true)
	int heartbeat(@Param("projectId") UUID projectId, @Param("holderId") UUID holderId, @Param("epoch") long epoch,
			@Param("ttlSeconds") long ttlSeconds);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = """
			update project_locks l
			   set released_at = now(),
			       epoch = l.epoch + 1
			 where l.project_id = :projectId
			   and l.holder_id = :holderId
			   and l.released_at is null
			   and l.expires_at > now()
			   and l.epoch = :epoch
			""", nativeQuery = true)
	int release(@Param("projectId") UUID projectId, @Param("holderId") UUID holderId, @Param("epoch") long epoch);
}
