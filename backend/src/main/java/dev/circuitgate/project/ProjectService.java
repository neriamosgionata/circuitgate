package dev.circuitgate.project;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;
import dev.circuitgate.lock.LockConflictException;
import dev.circuitgate.project.ProjectDocumentValidator.ValidatedProject;
import dev.circuitgate.project.dto.ProjectDtos.CreateProjectRequest;
import dev.circuitgate.project.dto.ProjectDtos.ExportEnvelope;
import dev.circuitgate.project.dto.ProjectDtos.ImportRequest;
import dev.circuitgate.project.dto.ProjectDtos.ProjectResponse;
import dev.circuitgate.project.dto.ProjectDtos.ProjectSummary;
import dev.circuitgate.project.dto.ProjectDtos.SaveProjectRequest;
import dev.circuitgate.realtime.RealtimeEvents;
import dev.circuitgate.realtime.RealtimePublisher;
import dev.circuitgate.realtime.RealtimeSessionRegistry;

import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectService {

	private final ProjectRepository projects;

	private final UserRepository users;

	private final ProjectAccess access;

	private final ProjectDocumentValidator validator;

	private final RealtimePublisher events;

	private final RealtimeSessionRegistry realtime;

	private final Clock clock;

	public ProjectService(ProjectRepository projects, UserRepository users, ProjectAccess access,
			ProjectDocumentValidator validator, RealtimePublisher events, RealtimeSessionRegistry realtime,
			Clock clock) {
		this.projects = projects;
		this.users = users;
		this.access = access;
		this.validator = validator;
		this.events = events;
		this.realtime = realtime;
		this.clock = clock;
	}

	@Transactional
	public ProjectResponse create(String ownerEmail, CreateProjectRequest request) {
		User owner = requireUser(ownerEmail);
		ValidatedProject validated = validator.validate(request.name(), request.schemaVersion(), request.document());
		Project project = new Project(UUID.randomUUID(), owner, validated.name(), validated.schemaVersion(),
				validated.document(), clock.instant());
		projects.save(project);
		return response(project, owner);
	}

	@Transactional(readOnly = true)
	public List<ProjectSummary> list(String ownerEmail) {
		User owner = requireUser(ownerEmail);
		Map<UUID, Project> accessible = new LinkedHashMap<>();
		projects.findByOwnerIdOrderByUpdatedAtDesc(owner.getId()).forEach(project -> accessible.put(project.getId(),
				project));
		projects.findSharedWith(owner.getId())
			.forEach(project -> accessible.putIfAbsent(project.getId(), project));
		List<Project> ordered = new ArrayList<>(accessible.values());
		ordered.sort(Comparator.comparing(Project::getUpdatedAt).reversed());
		return ordered.stream().map(project -> summary(project, owner)).toList();
	}

	@Transactional(readOnly = true)
	public ProjectResponse get(String ownerEmail, UUID id) {
		User user = requireUser(ownerEmail);
		Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
		access.requireCanRead(project, user.getId());
		return response(project, user);
	}

	@Transactional
	public ProjectResponse save(String ownerEmail, UUID id, SaveProjectRequest request) {
		User user = requireUser(ownerEmail);
		ValidatedProject validated = validator.validate(request.name(), request.schemaVersion(), request.document());
		int updated = projects.saveIfVersionMatchesForEditor(id, user.getId(), validated.name(),
				validated.document().toString(), validated.schemaVersion(), request.version(), request.lockEpoch());
		if (updated == 0) {
			Project current = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
			access.requireCanEdit(current, user.getId());
			if (current.getContentVersion() != request.version()) {
				throw new ProjectConflictException(current.getContentVersion());
			}
			throw new LockConflictException("lock_expired", current.getContentVersion());
		}
		Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
		events.publish(new RealtimeEvents.Event.ProjectSaved(id, project.getContentVersion(), user.getId()));
		return response(project, user);
	}

	@Transactional
	public void delete(String ownerEmail, UUID id) {
		User owner = requireUser(ownerEmail);
		if (projects.deleteOwned(id, owner.getId()) == 0) {
			throw new ProjectNotFoundException();
		}
		events.publish(new RealtimeEvents.Event.ProjectDeleted(id, owner.getId()));
		events.runAfterCommit(() -> realtime.disconnectSubscribers(id, Set.of()));
	}

	@Transactional(readOnly = true)
	public ExportEnvelope export(String ownerEmail, UUID id) {
		User user = requireUser(ownerEmail);
		Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
		access.requireCanRead(project, user.getId());
		return new ExportEnvelope(ProjectDocumentValidator.FORMAT, project.getSchemaVersion(),
				project.getContentVersion(), project.getName(), project.getDocument());
	}

	@Transactional
	public ProjectResponse importProject(String ownerEmail, ImportRequest request) {
		User owner = requireUser(ownerEmail);
		ValidatedProject validated = validator.validateImport(request);
		Project project = new Project(UUID.randomUUID(), owner, validated.name(), validated.schemaVersion(),
				validated.document(), clock.instant());
		projects.save(project);
		return response(project, owner);
	}

	private User requireUser(String email) {
		return users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the authenticated principal"));
	}

	private static ProjectResponse response(Project project, User viewer) {
		return new ProjectResponse(project.getId(), project.getName(), project.getSchemaVersion(),
				project.getContentVersion(), project.getOwner().getId(), owns(project, viewer),
				project.getDocument(), project.getCreatedAt(), project.getUpdatedAt());
	}

	private static ProjectSummary summary(Project project, User viewer) {
		return new ProjectSummary(project.getId(), project.getName(), project.getContentVersion(),
				project.getOwner().getId(), owns(project, viewer), project.getCreatedAt(), project.getUpdatedAt());
	}

	private static boolean owns(Project project, User viewer) {
		return project.getOwner().getId().equals(viewer.getId());
	}
}
