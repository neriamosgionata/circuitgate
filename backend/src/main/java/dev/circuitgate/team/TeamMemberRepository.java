package dev.circuitgate.team;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TeamMemberRepository extends JpaRepository<TeamMember, TeamMemberId> {

	@Query("""
			select membership from TeamMember membership
			  join fetch membership.user
			 where membership.team.id = :teamId
			 order by membership.createdAt asc, membership.user.email asc
			""")
	List<TeamMember> findByTeamIdWithUser(@Param("teamId") UUID teamId);

	@Query("""
			select membership from TeamMember membership
			  join fetch membership.team team
			  join fetch team.owner
			 where membership.user.id = :userId
			 order by team.createdAt desc, team.name asc
			""")
	List<TeamMember> findMembershipsForUser(@Param("userId") UUID userId);

	@Query("""
			select membership from TeamMember membership
			 where membership.team.id = :teamId
			   and membership.user.id = :userId
			""")
	Optional<TeamMember> findMembership(@Param("teamId") UUID teamId, @Param("userId") UUID userId);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = """
			insert into team_members (team_id, user_id, role)
			values (:teamId, :userId, :role)
			on conflict (team_id, user_id) do nothing
			""", nativeQuery = true)
	int insertIfAbsent(@Param("teamId") UUID teamId, @Param("userId") UUID userId, @Param("role") String role);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			delete from TeamMember membership
			 where membership.team.id = :teamId
			   and membership.user.id = :userId
			""")
	int deleteMembership(@Param("teamId") UUID teamId, @Param("userId") UUID userId);
}
