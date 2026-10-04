package dev.circuitgate.config;

import java.util.Map;

import dev.circuitgate.account.InvalidPasswordException;
import dev.circuitgate.account.InvalidTokenException;
import dev.circuitgate.account.RateLimitedException;
import dev.circuitgate.account.SendMailException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

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

	@ExceptionHandler(Exception.class)
	@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
	public Map<String, String> internalError(Exception ex) {
		log.error("Unhandled request error", ex);
		return Map.of("error", "internal_error");
	}
}
