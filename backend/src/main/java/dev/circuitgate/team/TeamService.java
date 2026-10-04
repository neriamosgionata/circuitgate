package dev.circuitgate.team;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;
import dev.circuitgate.team.dto.TeamDtos.AddTeamMemberRequest;
import dev.circuitgate.team.dto.TeamDtos.CreateTeamRequest;
import dev.circuitgate.team.dto.TeamDtos.TeamDetailResponse;
import dev.circuitgate.team.dto.TeamDtos.TeamMemberResponse;
import dev.circuitgate.team.dto.TeamDtos.TeamSummary;

import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamService {

	static final String ROLE_OWNER = "owner";

	static final String ROLE_MEMBER = "member";

	private final TeamRepository teams;

	private final TeamMemberRepository members;

	private final UserRepository users;

	private final Clock clock;

	public TeamService(TeamRepository teams, TeamMemberRepository members, UserRepository users, Clock clock) {
		this.teams = teams;
		this.members = members;
		this.users = users;
		this.clock = clock;
	}

	@Transactional
	public TeamDetailResponse create(String email, CreateTeamRequest request) {
		User owner = requireUser(email);
		Team team = new Team(UUID.randomUUID(), owner, request.name().trim(), clock.instant());
		teams.save(team);
		members.insertIfAbsent(team.getId(), owner.getId(), ROLE_OWNER);
		TeamMember membership = members.findMembership(team.getId(), owner.getId())
			.orElseThrow(() -> new IllegalStateException("owner membership was not persisted"));
		return detail(team, membership.getRole());
	}

	@Transactional(readOnly = true)
	public List<TeamSummary> list(String email) {
		User user = requireUser(email);
		return members.findMembershipsForUser(user.getId())
			.stream()
			.map(membership -> new TeamSummary(membership.getTeam().getId(), membership.getTeam().getName(),
					membership.getRole(), membership.getTeam().getOwner().getId(),
					membership.getTeam().getCreatedAt()))
			.toList();
	}

	@Transactional(readOnly = true)
	public TeamDetailResponse get(String email, UUID teamId) {
		User user = requireUser(email);
		Team team = requireTeam(teamId);
		TeamMember membership = members.findMembership(teamId, user.getId())
			.orElseThrow(TeamNotFoundException::new);
		return detail(team, membership.getRole());
	}

	@Transactional
	public MemberAddResult addMember(String email, UUID teamId, AddTeamMemberRequest request) {
		User actor = requireUser(email);
		Team team = requireOwnedTeam(teamId, actor);
		User target = users.findByEmailIgnoreCase(request.email().trim())
			.filter(User::isEmailVerified)
			.orElseThrow(MemberNotAvailableException::new);
		boolean created = members.insertIfAbsent(team.getId(), target.getId(), ROLE_MEMBER) == 1;
		TeamMember membership = members.findMembership(teamId, target.getId())
			.orElseThrow(() -> new IllegalStateException("membership was not persisted"));
		return new MemberAddResult(created, memberResponse(membership));
	}

	@Transactional
	public void removeMember(String email, UUID teamId, UUID memberId) {
		User actor = requireUser(email);
		Team team = requireOwnedTeam(teamId, actor);
		if (team.getOwner().getId().equals(memberId)) {
			throw new OwnerCannotBeRemovedException();
		}
		if (members.deleteMembership(teamId, memberId) == 0) {
			throw new TeamMemberNotFoundException();
		}
	}

	private Team requireTeam(UUID teamId) {
		return teams.findById(teamId).orElseThrow(TeamNotFoundException::new);
	}

	private Team requireOwnedTeam(UUID teamId, User actor) {
		Team team = requireTeam(teamId);
		if (!team.getOwner().getId().equals(actor.getId())) {
			throw new TeamNotFoundException();
		}
		return team;
	}

	private User requireUser(String email) {
		return users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the authenticated principal"));
	}

	private TeamDetailResponse detail(Team team, String viewerRole) {
		List<TeamMemberResponse> memberList = members.findByTeamIdWithUser(team.getId())
			.stream()
			.map(TeamService::memberResponse)
			.toList();
		return new TeamDetailResponse(team.getId(), team.getName(), viewerRole, team.getOwner().getId(),
				team.getCreatedAt(), memberList);
	}

	private static TeamMemberResponse memberResponse(TeamMember membership) {
		return new TeamMemberResponse(membership.getUser().getId(), membership.getUser().getEmail(),
				membership.getRole(), membership.getCreatedAt());
	}

	public record MemberAddResult(boolean created, TeamMemberResponse member) {
	}
}
