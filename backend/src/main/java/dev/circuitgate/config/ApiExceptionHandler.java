package dev.circuitgate.config;

import java.util.LinkedHashMap;
import java.util.Map;

import dev.circuitgate.account.InvalidPasswordException;
import dev.circuitgate.account.InvalidTokenException;
import dev.circuitgate.account.RateLimitedException;
import dev.circuitgate.account.SendMailException;
import dev.circuitgate.lock.LockConflictException;
import dev.circuitgate.lock.ProjectLockedException;
import dev.circuitgate.project.InvalidProjectDocumentException;
import dev.circuitgate.project.ProjectConflictException;
import dev.circuitgate.project.ProjectNotFoundException;
import dev.circuitgate.project.ProjectPayloadTooLargeException;
import dev.circuitgate.sharing.ShareNotFoundException;
import dev.circuitgate.team.MemberNotAvailableException;
import dev.circuitgate.team.OwnerCannotBeRemovedException;
import dev.circuitgate.team.TeamMemberNotFoundException;
import dev.circuitgate.team.TeamNotFoundException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

	@ExceptionHandler(InvalidTokenException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, String> invalidToken() {
		return Map.of("error", "invalid_token");
	}

	@ExceptionHandler(InvalidPasswordException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, String> invalidPassword() {
		return Map.of("error", "invalid_password");
	}

	@ExceptionHandler(RateLimitedException.class)
	@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
	public Map<String, String> rateLimited() {
		return Map.of("error", "rate_limited");
	}

	@ExceptionHandler(SendMailException.class)
	@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
	public Map<String, String> mailUnavailable() {
		return Map.of("error", "mail_unavailable");
	}

	@ExceptionHandler(ProjectNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public Map<String, String> projectNotFound() {
		return Map.of("error", "not_found");
	}

	@ExceptionHandler({ TeamNotFoundException.class, TeamMemberNotFoundException.class, ShareNotFoundException.class })
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public Map<String, String> teamNotFound() {
		return Map.of("error", "not_found");
	}

	@ExceptionHandler(ProjectLockedException.class)
	@ResponseStatus(HttpStatus.CONFLICT)
	public Map<String, Object> projectLocked(ProjectLockedException ex) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("error", "locked");
		body.put("lock", ex.getLock());
		return body;
	}

	@ExceptionHandler(LockConflictException.class)
	@ResponseStatus(HttpStatus.CONFLICT)
	public Map<String, Object> lockConflict(LockConflictException ex) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("error", "lock_conflict");
		body.put("reason", ex.getReason());
		if (ex.getVersion() != null) {
			body.put("version", ex.getVersion());
		}
		return body;
	}

	@ExceptionHandler(MemberNotAvailableException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public Map<String, String> memberNotAvailable() {
		return Map.of("error", "member_not_available");
	}

	@ExceptionHandler(OwnerCannotBeRemovedException.class)
	@ResponseStatus(HttpStatus.CONFLICT)
	public Map<String, String> ownerCannotBeRemoved() {
		return Map.of("error", "owner_cannot_be_removed");
	}

	@ExceptionHandler(ProjectConflictException.class)
	@ResponseStatus(HttpStatus.CONFLICT)
	public Map<String, Object> projectConflict(ProjectConflictException ex) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("error", "conflict");
		body.put("version", ex.getCurrentVersion());
		return body;
	}

	@ExceptionHandler(InvalidProjectDocumentException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, String> invalidProjectDocument() {
		return Map.of("error", "invalid_project_document");
	}

	@ExceptionHandler(ProjectPayloadTooLargeException.class)
	@ResponseStatus(HttpStatus.PAYLOAD_TOO_LARGE)
	public Map<String, String> projectPayloadTooLarge() {
		return Map.of("error", "payload_too_large");
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, String> invalidRequest() {
		return Map.of("error", "invalid_request");
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, String> unreadableRequest() {
		return Map.of("error", "invalid_request");
	}

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public Map<String, String> invalidPathParameter() {
		return Map.of("error", "invalid_request");
	}

	@ExceptionHandler(Exception.class)
	@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
	public Map<String, String> internalError(Exception ex) {
		log.error("Unhandled request error", ex);
		return Map.of("error", "internal_error");
	}
}
