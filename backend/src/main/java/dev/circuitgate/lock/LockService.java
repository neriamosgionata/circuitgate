package dev.circuitgate.lock;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;
import dev.circuitgate.config.CircuitGateProperties;
import dev.circuitgate.lock.dto.LockDtos.LockStateResponse;
import dev.circuitgate.project.Project;
import dev.circuitgate.project.ProjectAccess;
import dev.circuitgate.project.ProjectNotFoundException;
import dev.circuitgate.project.ProjectRepository;
import dev.circuitgate.realtime.RealtimeEvents;
import dev.circuitgate.realtime.RealtimePublisher;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LockService {

	private static final Logger log = LoggerFactory.getLogger(LockService.class);

	private static final String LOCK_ROW_COLUMNS = "l.project_id, l.holder_id, l.epoch, l.expires_at, "
			+ "(select u.email from users u where u.id = l.holder_id)";

	private final ProjectLockRepository locks;

	private final ProjectRepository projects;

	private final UserRepository users;

	private final ProjectAccess access;

	private final RealtimePublisher events;

	private final JdbcTemplate jdbc;

	private final CircuitGateProperties properties;

	public LockService(ProjectLockRepository locks, ProjectRepository projects, UserRepository users,
			ProjectAccess access, RealtimePublisher events, JdbcTemplate jdbc, CircuitGateProperties properties) {
		this.locks = locks;
		this.projects = projects;
		this.users = users;
		this.access = access;
		this.events = events;
		this.jdbc = jdbc;
		this.properties = properties;
	}

	@Transactional(readOnly = true)
	public LockStateResponse state(String email, UUID projectId) {
		User actor = requireUser(email);
		Project project = requireProject(projectId);
		access.requireCanRead(project, actor.getId());
		return locks.findByProjectIdWithHolder(projectId)
			.map(lock -> response(projectId, lock, actor))
			.orElseGet(() -> unlocked(projectId));
	}

	@Transactional
	public LockStateResponse acquire(String email, UUID projectId) {
		User actor = requireUser(email);
		Project project = requireProject(projectId);
		access.requireCanEdit(project, actor.getId());
		long ttlSeconds = properties.getLocks().ttlSeconds();
		int inserted = locks.acquire(projectId, actor.getId(), ttlSeconds);
		ProjectLock current = locks.findByProjectIdWithHolder(projectId)
			.orElseThrow(() -> new IllegalStateException("lock row missing after acquisition attempt"));
		if (inserted == 0) {
			throw new ProjectLockedException(response(projectId, current, actor));
		}
		events.publish(new RealtimeEvents.Event.LockChanged(projectId, current.getEpoch(), actor.getId(),
				actor.getEmail(), current.getExpiresAt(), true, "acquired"));
		log.debug("Project {} locked by {} at epoch {}", projectId, actor.getId(), current.getEpoch());
		return response(projectId, current, actor);
	}

	@Transactional
	public LockStateResponse heartbeat(String email, UUID projectId, long epoch) {
		User actor = requireUser(email);
		Project project = requireProject(projectId);
		access.requireCanEdit(project, actor.getId());
		int updated = locks.heartbeat(projectId, actor.getId(), epoch, properties.getLocks().ttlSeconds());
		if (updated == 0) {
			throw new LockConflictException("expired");
		}
		ProjectLock current = locks.findByProjectIdWithHolder(projectId)
			.orElseThrow(() -> new IllegalStateException("lock row missing after heartbeat"));
		return response(projectId, current, actor);
	}

	@Transactional
	public void release(String email, UUID projectId, long epoch) {
		User actor = requireUser(email);
		Project project = requireProject(projectId);
		access.requireCanEdit(project, actor.getId());
		int updated = locks.release(projectId, actor.getId(), epoch);
		if (updated == 0) {
			throw new LockConflictException("stale_release");
		}
		ProjectLock current = locks.findByProjectIdWithHolder(projectId)
			.orElseThrow(() -> new IllegalStateException("lock row missing after release"));
		events.publish(new RealtimeEvents.Event.LockChanged(projectId, current.getEpoch(), current.getHolder().getId(),
				current.getHolder().getEmail(), current.getExpiresAt(), false, "released"));
	}

	@Transactional
	public List<LockTransition> forceReleaseForUnshare(UUID projectId, UUID teamId) {
		List<LockTransition> transitions = jdbc.query("""
				update project_locks l
				   set released_at = now(),
				       epoch = l.epoch + 1
				 where l.project_id = ?
				   and l.released_at is null
				   and l.expires_at > now()
				   and l.holder_id <> (select p.owner_id from projects p where p.id = l.project_id)
				   and exists (select 1 from team_members tm where tm.team_id = ? and tm.user_id = l.holder_id)
				   and not exists (
				       select 1 from project_teams pt
				         join team_members tm2 on tm2.team_id = pt.team_id
				        where pt.project_id = l.project_id
				          and pt.team_id <> ?
				          and tm2.user_id = l.holder_id)
				 returning %s
				""".formatted(LOCK_ROW_COLUMNS), LockService::transition, projectId, teamId, teamId);
		publishForced(transitions);
		return transitions;
	}

	@Transactional
	public List<LockTransition> forceReleaseForMemberRemoval(UUID teamId, UUID userId) {
		List<LockTransition> transitions = jdbc.query("""
				update project_locks l
				   set released_at = now(),
				       epoch = l.epoch + 1
				 where l.released_at is null
				   and l.expires_at > now()
				   and l.holder_id = ?
				   and l.project_id in (select pt.project_id from project_teams pt where pt.team_id = ?)
				   and exists (select 1 from projects p where p.id = l.project_id and p.owner_id <> l.holder_id)
				   and not exists (
				       select 1 from project_teams pt2
				         join team_members tm2 on tm2.team_id = pt2.team_id
				        where pt2.project_id = l.project_id
				          and tm2.user_id = l.holder_id)
				 returning %s
				""".formatted(LOCK_ROW_COLUMNS), LockService::transition, userId, teamId);
		publishForced(transitions);
		return transitions;
	}

	@Transactional
	public List<LockTransition> expireOverdue() {
		List<LockTransition> transitions = jdbc.query("""
				update project_locks l
				   set released_at = now(),
				       epoch = l.epoch + 1
				 where l.released_at is null
				   and l.expires_at <= now()
				 returning %s
				""".formatted(LOCK_ROW_COLUMNS), LockService::transition);
		for (LockTransition transition : transitions) {
			events.publish(new RealtimeEvents.Event.LockChanged(transition.projectId(), transition.epoch(),
					transition.holderId(), transition.holderEmail(), transition.expiresAt(), false, "expired"));
		}
		return transitions;
	}

	private void publishForced(List<LockTransition> transitions) {
		for (LockTransition transition : transitions) {
			events.publish(new RealtimeEvents.Event.LockChanged(transition.projectId(), transition.epoch(),
					transition.holderId(), transition.holderEmail(), transition.expiresAt(), false, transition.reason()));
		}
	}

	private static LockTransition transition(ResultSet rs, int rowNum) throws SQLException {
		return new LockTransition(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(5),
				rs.getLong(3), rs.getObject(4, OffsetDateTime.class).toInstant(), "forced");
	}

	private LockStateResponse response(UUID projectId, ProjectLock lock, User actor) {
		boolean active = Boolean.TRUE.equals(locks.isActiveNow(projectId));
		boolean holder = active && lock.getHolder().getId().equals(actor.getId());
		long ttlSeconds = properties.getLocks().ttlSeconds();
		long heartbeatSeconds = properties.getLocks().heartbeatSeconds();
		if (!active) {
			return new LockStateResponse(projectId, false, false, lock.getHolder().getId(),
					lock.getHolder().getEmail(), lock.getEpoch(), null, null, ttlSeconds, heartbeatSeconds);
		}
		return new LockStateResponse(projectId, true, holder, lock.getHolder().getId(), lock.getHolder().getEmail(),
				lock.getEpoch(), lock.getAcquiredAt(), lock.getExpiresAt(), ttlSeconds, heartbeatSeconds);
	}

	private LockStateResponse unlocked(UUID projectId) {
		return new LockStateResponse(projectId, false, false, null, null, 0, null, null,
				properties.getLocks().ttlSeconds(), properties.getLocks().heartbeatSeconds());
	}

	private Project requireProject(UUID projectId) {
		return projects.findById(projectId).orElseThrow(ProjectNotFoundException::new);
	}

	private User requireUser(String email) {
		return users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the authenticated principal"));
	}
}
