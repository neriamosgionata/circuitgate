package dev.circuitgate.account;

import java.io.IOException;
import java.util.Locale;

import dev.circuitgate.account.dto.AccountDtos.LoginRequest;
import dev.circuitgate.config.ClientAddressResolver;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.util.StringUtils;

import tools.jackson.databind.ObjectMapper;

public class JsonLoginFilter extends AbstractAuthenticationProcessingFilter {

	public static final String ATTEMPTED_EMAIL_ATTRIBUTE = JsonLoginFilter.class.getName() + ".ATTEMPTED_EMAIL";

	private final ObjectMapper objectMapper;

	private final ClientAddressResolver addressResolver;

	private final ThrottlingService throttling;

	public JsonLoginFilter(ObjectMapper objectMapper, ClientAddressResolver addressResolver,
			ThrottlingService throttling, AuthenticationManager authenticationManager) {
		super(loginMatcher(), authenticationManager);
		this.objectMapper = objectMapper;
		this.addressResolver = addressResolver;
		this.throttling = throttling;
	}

	private static RequestMatcher loginMatcher() {
		return PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/auth/login");
	}

	@Override
	public Authentication attemptAuthentication(HttpServletRequest request, HttpServletResponse response)
			throws IOException {
		LoginRequest login;
		try {
			login = objectMapper.readValue(request.getInputStream(), LoginRequest.class);
		}
		catch (RuntimeException ex) {
			throw new BadCredentialsException("Invalid login request");
		}
		if (login == null || !StringUtils.hasText(login.email()) || !StringUtils.hasText(login.password())) {
			throw new BadCredentialsException("Invalid login request");
		}
		String email = login.email().trim().toLowerCase(Locale.ROOT);
		request.setAttribute(ATTEMPTED_EMAIL_ATTRIBUTE, email);
		if (Boolean.TRUE.equals(login.rememberMe())) {
			request.setAttribute(HashedPersistentTokenRememberMeServices.REMEMBER_ME_REQUEST_ATTRIBUTE, Boolean.TRUE);
		}
		String source = addressResolver.resolve(request);
		if (throttling.isLoginBlocked(email, source)) {
			throw new ThrottledAuthenticationException();
		}
		UsernamePasswordAuthenticationToken authentication = UsernamePasswordAuthenticationToken.unauthenticated(email,
				login.password());
		authentication.setDetails(this.authenticationDetailsSource.buildDetails(request));
		return getAuthenticationManager().authenticate(authentication);
	}
}
