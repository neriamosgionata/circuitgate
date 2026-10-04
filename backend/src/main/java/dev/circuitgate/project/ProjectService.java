package dev.circuitgate.project;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;
import dev.circuitgate.project.ProjectDocumentValidator.ValidatedProject;
import dev.circuitgate.project.dto.ProjectDtos.CreateProjectRequest;
import dev.circuitgate.project.dto.ProjectDtos.ExportEnvelope;
import dev.circuitgate.project.dto.ProjectDtos.ImportRequest;
import dev.circuitgate.project.dto.ProjectDtos.ProjectResponse;
import dev.circuitgate.project.dto.ProjectDtos.ProjectSummary;
import dev.circuitgate.project.dto.ProjectDtos.SaveProjectRequest;

import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProjectService {

	private final ProjectRepository projects;

	private final UserRepository users;

	private final ProjectAccess access;

	private final ProjectDocumentValidator validator;

	private final Clock clock;

	public ProjectService(ProjectRepository projects, UserRepository users, ProjectAccess access,
			ProjectDocumentValidator validator, Clock clock) {
		this.projects = projects;
		this.users = users;
		this.access = access;
		this.validator = validator;
		this.clock = clock;
	}

	@Transactional
	public ProjectResponse create(String ownerEmail, CreateProjectRequest request) {
		User owner = requireUser(ownerEmail);
		ValidatedProject validated = validator.validate(request.name(), request.schemaVersion(), request.document());
		Project project = new Project(UUID.randomUUID(), owner, validated.name(), validated.schemaVersion(),
				validated.document(), clock.instant());
		projects.save(project);
		return response(project);
	}

	@Transactional(readOnly = true)
	public List<ProjectSummary> list(String ownerEmail) {
		User owner = requireUser(ownerEmail);
		return projects.findByOwnerIdOrderByUpdatedAtDesc(owner.getId()).stream().map(ProjectService::summary).toList();
	}

	@Transactional(readOnly = true)
	public ProjectResponse get(String ownerEmail, UUID id) {
		User owner = requireUser(ownerEmail);
		Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
		access.requireCanRead(project, owner.getId());
		return response(project);
	}

	@Transactional
	public ProjectResponse save(String ownerEmail, UUID id, SaveProjectRequest request) {
		User owner = requireUser(ownerEmail);
		ValidatedProject validated = validator.validate(request.name(), request.schemaVersion(), request.document());
		int updated = projects.saveIfVersionMatches(id, owner.getId(), validated.name(), validated.document(),
				validated.schemaVersion(), request.version(), clock.instant());
		if (updated == 0) {
			Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
			access.requireCanEdit(project, owner.getId());
			throw new ProjectConflictException(project.getContentVersion());
		}
		Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
		return response(project);
	}

	@Transactional
	public void delete(String ownerEmail, UUID id) {
		User owner = requireUser(ownerEmail);
		if (projects.deleteOwned(id, owner.getId()) == 0) {
			throw new ProjectNotFoundException();
		}
	}

	@Transactional(readOnly = true)
	public ExportEnvelope export(String ownerEmail, UUID id) {
		User owner = requireUser(ownerEmail);
		Project project = projects.findById(id).orElseThrow(ProjectNotFoundException::new);
		access.requireCanRead(project, owner.getId());
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
		return response(project);
	}

	private User requireUser(String email) {
		return users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the authenticated principal"));
	}

	private static ProjectResponse response(Project project) {
		return new ProjectResponse(project.getId(), project.getName(), project.getSchemaVersion(),
				project.getContentVersion(), project.getDocument(), project.getCreatedAt(), project.getUpdatedAt());
	}

	private static ProjectSummary summary(Project project) {
		return new ProjectSummary(project.getId(), project.getName(), project.getContentVersion(),
				project.getCreatedAt(), project.getUpdatedAt());
	}
}
