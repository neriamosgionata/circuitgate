package dev.circuitgate.lock;

import java.util.UUID;

import dev.circuitgate.lock.dto.LockDtos.HeartbeatRequest;
import dev.circuitgate.lock.dto.LockDtos.LockStateResponse;
import dev.circuitgate.lock.dto.LockDtos.ReleaseRequest;

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
@RequestMapping("/api/projects/{projectId}/lock")
public class LockController {

	private final LockService locks;

	public LockController(LockService locks) {
		this.locks = locks;
	}

	@GetMapping
	public LockStateResponse state(@PathVariable UUID projectId, Authentication authentication) {
		return locks.state(authentication.getName(), projectId);
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public LockStateResponse acquire(@PathVariable UUID projectId, Authentication authentication) {
		return locks.acquire(authentication.getName(), projectId);
	}

	@PostMapping("/heartbeat")
	public LockStateResponse heartbeat(@PathVariable UUID projectId, @Valid @RequestBody HeartbeatRequest request,
			Authentication authentication) {
		return locks.heartbeat(authentication.getName(), projectId, request.epoch());
	}

	@DeleteMapping
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void release(@PathVariable UUID projectId, @Valid @RequestBody ReleaseRequest request,
			Authentication authentication) {
		locks.release(authentication.getName(), projectId, request.epoch());
	}
}
