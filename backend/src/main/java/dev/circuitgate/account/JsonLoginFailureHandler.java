package dev.circuitgate.account;

import java.io.IOException;
import java.util.Locale;
import java.util.Map;

import dev.circuitgate.config.ApiResponses;
import dev.circuitgate.config.ClientAddressResolver;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.authentication.DisabledException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;

import tools.jackson.databind.ObjectMapper;

public class JsonLoginFailureHandler implements AuthenticationFailureHandler {

	private final ObjectMapper objectMapper;

	private final ThrottlingService throttling;

	private final ClientAddressResolver addressResolver;

	public JsonLoginFailureHandler(ObjectMapper objectMapper, ThrottlingService throttling,
			ClientAddressResolver addressResolver) {
		this.objectMapper = objectMapper;
		this.throttling = throttling;
		this.addressResolver = addressResolver;
	}

	@Override
	public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
			AuthenticationException exception) throws IOException {
		if (exception instanceof ThrottledAuthenticationException) {
			ApiResponses.write(response, objectMapper, HttpServletResponse.SC_UNAUTHORIZED,
					Map.of("error", "invalid_credentials"));
			return;
		}
		if (exception instanceof DisabledException) {
			ApiResponses.write(response, objectMapper, HttpServletResponse.SC_FORBIDDEN,
					Map.of("error", "email_not_verified"));
			return;
		}
		Object attemptedEmail = request.getAttribute(JsonLoginFilter.ATTEMPTED_EMAIL_ATTRIBUTE);
		if (attemptedEmail instanceof String email) {
			throttling.recordLoginFailure(email.toLowerCase(Locale.ROOT), addressResolver.resolve(request));
		}
		ApiResponses.write(response, objectMapper, HttpServletResponse.SC_UNAUTHORIZED,
				Map.of("error", "invalid_credentials"));
	}
}
