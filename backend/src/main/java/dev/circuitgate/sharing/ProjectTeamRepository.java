package dev.circuitgate.sharing;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectTeamRepository extends JpaRepository<ProjectTeam, ProjectTeamId> {

	@Query("""
			select share from ProjectTeam share
			  join fetch share.team
			 where share.project.id = :projectId
			 order by share.createdAt asc, share.team.name asc
			""")
	List<ProjectTeam> findByProjectIdWithTeam(@Param("projectId") UUID projectId);

	@Query("""
			select share from ProjectTeam share
			 where share.project.id = :projectId
			   and share.team.id = :teamId
			""")
	Optional<ProjectTeam> findShare(@Param("projectId") UUID projectId, @Param("teamId") UUID teamId);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = """
			insert into project_teams (project_id, team_id, created_by)
			values (:projectId, :teamId, :createdBy)
			on conflict (project_id, team_id) do nothing
			""", nativeQuery = true)
	int insertIfAbsent(@Param("projectId") UUID projectId, @Param("teamId") UUID teamId,
			@Param("createdBy") UUID createdBy);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			delete from ProjectTeam share
			 where share.project.id = :projectId
			   and share.team.id = :teamId
			""")
	int deleteShare(@Param("projectId") UUID projectId, @Param("teamId") UUID teamId);

	@Query(value = """
			select exists (
			    select 1 from project_teams pt
			      join team_members tm on tm.team_id = pt.team_id
			     where pt.project_id = :projectId
			       and tm.user_id = :userId
			)
			""", nativeQuery = true)
	boolean hasAccess(@Param("projectId") UUID projectId, @Param("userId") UUID userId);

	@Query(value = "select count(*) from project_teams where project_id = :projectId", nativeQuery = true)
	long countForProject(@Param("projectId") UUID projectId);

	@Query(value = "select team_id from project_teams where project_id = :projectId", nativeQuery = true)
	List<UUID> findTeamIdsForProject(@Param("projectId") UUID projectId);

	@Query(value = "select project_id from project_teams where team_id = :teamId", nativeQuery = true)
	List<UUID> findProjectIdsForTeam(@Param("teamId") UUID teamId);
}
