package dev.circuitgate.team;

import java.util.List;
import java.util.UUID;

import dev.circuitgate.team.dto.TeamDtos.AddTeamMemberRequest;
import dev.circuitgate.team.dto.TeamDtos.CreateTeamRequest;
import dev.circuitgate.team.dto.TeamDtos.TeamDetailResponse;
import dev.circuitgate.team.dto.TeamDtos.TeamMemberResponse;
import dev.circuitgate.team.dto.TeamDtos.TeamSummary;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/teams")
public class TeamController {

	private final TeamService teams;

	public TeamController(TeamService teams) {
		this.teams = teams;
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public TeamDetailResponse create(@Valid @RequestBody CreateTeamRequest request, Authentication authentication) {
		return teams.create(authentication.getName(), request);
	}

	@GetMapping
	public List<TeamSummary> list(Authentication authentication) {
		return teams.list(authentication.getName());
	}

	@GetMapping("/{id}")
	public TeamDetailResponse get(@PathVariable UUID id, Authentication authentication) {
		return teams.get(authentication.getName(), id);
	}

	@PostMapping("/{id}/members")
	public ResponseEntity<TeamMemberResponse> addMember(@PathVariable UUID id,
			@Valid @RequestBody AddTeamMemberRequest request, Authentication authentication) {
		TeamService.MemberAddResult result = teams.addMember(authentication.getName(), id, request);
		return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result.member());
	}

	@DeleteMapping("/{id}/members/{userId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void removeMember(@PathVariable UUID id, @PathVariable UUID userId, Authentication authentication) {
		teams.removeMember(authentication.getName(), id, userId);
	}
}
