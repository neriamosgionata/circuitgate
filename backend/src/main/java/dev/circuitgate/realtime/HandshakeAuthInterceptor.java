package dev.circuitgate.realtime;

import java.util.List;
import java.util.Map;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;
import dev.circuitgate.config.CircuitGateProperties;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.socket.server.support.HttpSessionHandshakeInterceptor;

public class HandshakeAuthInterceptor implements HandshakeInterceptor {

	public static final String ATTR_USER_ID = "circuitgate.userId";

	public static final String ATTR_EMAIL = "circuitgate.email";

	public static final String ATTR_CSRF_HEADER = "circuitgate.csrfHeader";

	public static final String ATTR_CSRF_TOKEN = "circuitgate.csrfToken";

	public static final String ATTR_HTTP_SESSION_ID = "circuitgate.httpSessionId";

	private static final Logger log = LoggerFactory.getLogger(HandshakeAuthInterceptor.class);

	private final List<String> allowedOrigins;

	private final UserRepository users;

	private final CsrfTokenRepository csrfTokenRepository;

	public HandshakeAuthInterceptor(CircuitGateProperties properties, UserRepository users,
			CsrfTokenRepository csrfTokenRepository) {
		List<String> configured = properties.getRealtime().getAllowedOrigins();
		this.allowedOrigins = configured.isEmpty() ? List.of(properties.getApp().getBaseUrl())
				: List.copyOf(configured);
		this.users = users;
		this.csrfTokenRepository = csrfTokenRepository;
	}

	@Override
	public boolean beforeHandshake(org.springframework.http.server.ServerHttpRequest request,
			org.springframework.http.server.ServerHttpResponse response, WebSocketHandler wsHandler,
			Map<String, Object> attributes) {
		String origin = request.getHeaders().getOrigin();
		if (origin == null || !allowedOrigins.contains(origin)) {
			log.info("Rejected WebSocket handshake with origin {}", origin);
			response.setStatusCode(HttpStatus.FORBIDDEN);
			return false;
		}
		Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
		if (authentication == null || !authentication.isAuthenticated()
				|| authentication instanceof AnonymousAuthenticationToken) {
			response.setStatusCode(HttpStatus.UNAUTHORIZED);
			return false;
		}
		User user = users.findByEmail(authentication.getName()).orElse(null);
		if (user == null) {
			response.setStatusCode(HttpStatus.UNAUTHORIZED);
			return false;
		}
		if (!(request instanceof org.springframework.http.server.ServletServerHttpRequest servletRequest)) {
			response.setStatusCode(HttpStatus.BAD_REQUEST);
			return false;
		}
		HttpServletRequest servlet = servletRequest.getServletRequest();
		CsrfToken token = csrfTokenRepository.loadToken(servlet);
		if (token == null) {
			log.info("Rejected WebSocket handshake without a CSRF token for {}", user.getEmail());
			response.setStatusCode(HttpStatus.FORBIDDEN);
			return false;
		}
		HttpSession session = servlet.getSession(false);
		attributes.put(HttpSessionHandshakeInterceptor.HTTP_SESSION_ID_ATTR_NAME,
				session == null ? "" : session.getId());
		attributes.put(ATTR_HTTP_SESSION_ID, session == null ? "" : session.getId());
		attributes.put(ATTR_USER_ID, user.getId().toString());
		attributes.put(ATTR_EMAIL, user.getEmail());
		attributes.put(ATTR_CSRF_HEADER, token.getHeaderName());
		attributes.put(ATTR_CSRF_TOKEN, token.getToken());
		return true;
	}

	@Override
	public void afterHandshake(org.springframework.http.server.ServerHttpRequest request,
			org.springframework.http.server.ServerHttpResponse response, WebSocketHandler wsHandler,
			Exception exception) {
	}
}
