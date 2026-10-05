package dev.circuitgate.sharing;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;
import dev.circuitgate.lock.LockService;
import dev.circuitgate.project.Project;
import dev.circuitgate.project.ProjectAccess;
import dev.circuitgate.project.ProjectNotFoundException;
import dev.circuitgate.project.ProjectRepository;
import dev.circuitgate.realtime.RealtimeEvents;
import dev.circuitgate.realtime.RealtimePublisher;
import dev.circuitgate.realtime.RealtimeSessionRegistry;
import dev.circuitgate.sharing.dto.SharingDtos.ShareResponse;
import dev.circuitgate.team.Team;
import dev.circuitgate.team.TeamMemberRepository;
import dev.circuitgate.team.TeamNotFoundException;
import dev.circuitgate.team.TeamRepository;

import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShareService {

	private final ProjectRepository projects;

	private final ProjectTeamRepository shares;

	private final TeamRepository teams;

	private final TeamMemberRepository members;

	private final UserRepository users;

	private final ProjectAccess access;

	private final LockService locks;

	private final RealtimePublisher events;

	private final RealtimeSessionRegistry realtime;

	public ShareService(ProjectRepository projects, ProjectTeamRepository shares, TeamRepository teams,
			TeamMemberRepository members, UserRepository users, ProjectAccess access, LockService locks,
			RealtimePublisher events, RealtimeSessionRegistry realtime) {
		this.projects = projects;
		this.shares = shares;
		this.teams = teams;
		this.members = members;
		this.users = users;
		this.access = access;
		this.locks = locks;
		this.events = events;
		this.realtime = realtime;
	}

	@Transactional
	public ShareResponse share(String email, UUID projectId, UUID teamId) {
		User actor = requireUser(email);
		Project project = requireOwnedProject(projectId, actor);
		Team team = teams.findById(teamId).orElseThrow(TeamNotFoundException::new);
		shares.insertIfAbsent(projectId, teamId, actor.getId());
		events.publish(new RealtimeEvents.Event.ShareChanged(projectId, teamId, actor.getId(), true));
		ProjectTeam share = shares.findShare(projectId, teamId)
			.orElseThrow(() -> new IllegalStateException("share row missing after insert"));
		return new ShareResponse(projectId, teamId, team.getName(), share.getCreatedAt());
	}

	@Transactional
	public void unshare(String email, UUID projectId, UUID teamId) {
		User actor = requireUser(email);
		requireOwnedProject(projectId, actor);
		if (shares.deleteShare(projectId, teamId) == 0) {
			throw new ShareNotFoundException();
		}
		locks.forceReleaseForUnshare(projectId, teamId);
		events.publish(new RealtimeEvents.Event.ShareChanged(projectId, teamId, actor.getId(), false));
		Set<UUID> affected = members.findByTeamIdWithUser(teamId)
			.stream()
			.map(member -> member.getUser().getId())
			.collect(Collectors.toUnmodifiableSet());
		events.runAfterCommit(() -> realtime.disconnectUsersFromProject(projectId, affected));
	}

	@Transactional(readOnly = true)
	public List<ShareResponse> list(String email, UUID projectId) {
		User actor = requireUser(email);
		Project project = projects.findById(projectId).orElseThrow(ProjectNotFoundException::new);
		access.requireCanRead(project, actor.getId());
		return shares.findByProjectIdWithTeam(projectId)
			.stream()
			.map(share -> new ShareResponse(projectId, share.getTeam().getId(), share.getTeam().getName(),
					share.getCreatedAt()))
			.toList();
	}

	private Project requireOwnedProject(UUID projectId, User actor) {
		Project project = projects.findById(projectId).orElseThrow(ProjectNotFoundException::new);
		if (!project.getOwner().getId().equals(actor.getId())) {
			throw new ProjectNotFoundException();
		}
		return project;
	}

	private User requireUser(String email) {
		return users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the authenticated principal"));
	}
}
