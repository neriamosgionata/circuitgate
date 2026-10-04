package dev.circuitgate.account;

import java.util.Locale;

import dev.circuitgate.config.ClientAddressResolver;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;

public class JsonLoginSuccessHandler implements AuthenticationSuccessHandler {

	private final ThrottlingService throttling;

	private final ClientAddressResolver addressResolver;

	public JsonLoginSuccessHandler(ThrottlingService throttling, ClientAddressResolver addressResolver) {
		this.throttling = throttling;
		this.addressResolver = addressResolver;
	}

	@Override
	public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
			Authentication authentication) {
		throttling.recordLoginSuccess(authentication.getName().toLowerCase(Locale.ROOT), addressResolver.resolve(request));
		response.setStatus(HttpServletResponse.SC_NO_CONTENT);
	}
}
