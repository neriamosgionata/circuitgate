package dev.circuitgate.project;

import java.util.UUID;

import dev.circuitgate.sharing.ProjectTeamRepository;

import org.springframework.stereotype.Component;

@Component
public class ProjectAccess {

	private final ProjectTeamRepository shares;

	public ProjectAccess(ProjectTeamRepository shares) {
		this.shares = shares;
	}

	public boolean canRead(Project project, UUID userId) {
		return project.getOwner().getId().equals(userId) || shares.hasAccess(project.getId(), userId);
	}

	public boolean canEdit(Project project, UUID userId) {
		return canRead(project, userId);
	}

	public void requireCanRead(Project project, UUID userId) {
		if (!canRead(project, userId)) {
			throw new ProjectNotFoundException();
		}
	}

	public void requireCanEdit(Project project, UUID userId) {
		if (!canEdit(project, userId)) {
			throw new ProjectNotFoundException();
		}
	}
}
