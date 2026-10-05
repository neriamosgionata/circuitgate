package dev.circuitgate.sharing;

import java.util.List;
import java.util.UUID;

import dev.circuitgate.sharing.dto.SharingDtos.CreateShareRequest;
import dev.circuitgate.sharing.dto.SharingDtos.ShareResponse;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
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
@RequestMapping("/api/projects/{projectId}/shares")
public class ShareController {

	private final ShareService shares;

	public ShareController(ShareService shares) {
		this.shares = shares;
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public ShareResponse share(@PathVariable UUID projectId, @Valid @RequestBody CreateShareRequest request,
			Authentication authentication) {
		return shares.share(authentication.getName(), projectId, request.teamId());
	}

	@GetMapping
	public List<ShareResponse> list(@PathVariable UUID projectId, Authentication authentication) {
		return shares.list(authentication.getName(), projectId);
	}

	@DeleteMapping("/{teamId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void unshare(@PathVariable UUID projectId, @PathVariable UUID teamId, Authentication authentication) {
		shares.unshare(authentication.getName(), projectId, teamId);
	}
}
