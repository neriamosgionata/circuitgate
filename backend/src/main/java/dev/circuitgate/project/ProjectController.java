package dev.circuitgate.project;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import dev.circuitgate.project.dto.ProjectDtos.CreateProjectRequest;
import dev.circuitgate.project.dto.ProjectDtos.ExportEnvelope;
import dev.circuitgate.project.dto.ProjectDtos.ImportRequest;
import dev.circuitgate.project.dto.ProjectDtos.ProjectResponse;
import dev.circuitgate.project.dto.ProjectDtos.ProjectSummary;
import dev.circuitgate.project.dto.ProjectDtos.SaveProjectRequest;

import jakarta.validation.Valid;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

	static final int MAX_FILENAME_BASE_LENGTH = 80;

	private final ProjectService projects;

	public ProjectController(ProjectService projects) {
		this.projects = projects;
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public ProjectResponse create(@Valid @RequestBody CreateProjectRequest request, Authentication authentication) {
		return projects.create(authentication.getName(), request);
	}

	@GetMapping
	public List<ProjectSummary> list(Authentication authentication) {
		return projects.list(authentication.getName());
	}

	@GetMapping("/{id}")
	public ProjectResponse get(@PathVariable UUID id, Authentication authentication) {
		return projects.get(authentication.getName(), id);
	}

	@PutMapping("/{id}")
	public ProjectResponse save(@PathVariable UUID id, @Valid @RequestBody SaveProjectRequest request,
			Authentication authentication) {
		return projects.save(authentication.getName(), id, request);
	}

	@DeleteMapping("/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@PathVariable UUID id, Authentication authentication) {
		projects.delete(authentication.getName(), id);
	}

	@GetMapping("/{id}/export")
	public ResponseEntity<ExportEnvelope> export(@PathVariable UUID id, Authentication authentication) {
		ExportEnvelope envelope = projects.export(authentication.getName(), id);
		String filename = sanitizeFilename(envelope.name()) + ".circuitgate.json";
		return ResponseEntity.ok()
			.header(HttpHeaders.CONTENT_DISPOSITION,
					ContentDisposition.attachment().filename(filename, StandardCharsets.UTF_8).build().toString())
			.body(envelope);
	}

	@PostMapping("/import")
	@ResponseStatus(HttpStatus.CREATED)
	public ProjectResponse importProject(@Valid @RequestBody ImportRequest request, Authentication authentication) {
		return projects.importProject(authentication.getName(), request);
	}

	static String sanitizeFilename(String name) {
		String sanitized = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]+", "-")
			.replaceAll("-{2,}", "-")
			.replaceAll("^[.-]+", "")
			.replaceAll("[.-]+$", "");
		if (sanitized.isEmpty()) {
			sanitized = "project";
		}
		return sanitized.length() > MAX_FILENAME_BASE_LENGTH ? sanitized.substring(0, MAX_FILENAME_BASE_LENGTH)
				: sanitized;
	}
}
