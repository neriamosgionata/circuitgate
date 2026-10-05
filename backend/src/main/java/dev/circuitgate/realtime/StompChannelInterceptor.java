package dev.circuitgate.realtime;

import java.util.Map;
import java.util.UUID;

import dev.circuitgate.project.Project;
import dev.circuitgate.project.ProjectAccess;
import dev.circuitgate.project.ProjectRepository;
import dev.circuitgate.team.TeamMemberRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;

public class StompChannelInterceptor implements ChannelInterceptor {

	private static final Logger log = LoggerFactory.getLogger(StompChannelInterceptor.class);

	private static final String PROJECT_TOPIC_PREFIX = "/topic/projects/";

	private static final String TEAM_TOPIC_PREFIX = "/topic/teams/";

	private final RealtimeSessionRegistry registry;

	private final ProjectRepository projects;

	private final ProjectAccess access;

	private final TeamMemberRepository members;

	public StompChannelInterceptor(RealtimeSessionRegistry registry, ProjectRepository projects, ProjectAccess access,
			TeamMemberRepository members) {
		this.registry = registry;
		this.projects = projects;
		this.access = access;
		this.members = members;
	}

	@Override
	public Message<?> preSend(Message<?> message, MessageChannel channel) {
		StompHeaderAccessor stomp = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
		if (stomp == null || stomp.getCommand() == null) {
			return message;
		}
		switch (stomp.getCommand()) {
			case CONNECT -> authenticate(stomp);
			case SUBSCRIBE -> authorizeSubscription(stomp);
			case SEND, MESSAGE -> throw new AccessDeniedException("client publishing is not allowed");
			case DISCONNECT -> registry.socketClosed(stomp.getSessionId());
			default -> {
			}
		}
		return message;
	}

	private void authenticate(StompHeaderAccessor stomp) {
		Map<String, Object> attributes = stomp.getSessionAttributes();
		if (attributes == null) {
			throw new AccessDeniedException("missing handshake attributes");
		}
		String expectedHeader = (String) attributes.get(HandshakeAuthInterceptor.ATTR_CSRF_HEADER);
		String expectedToken = (String) attributes.get(HandshakeAuthInterceptor.ATTR_CSRF_TOKEN);
		String email = (String) attributes.get(HandshakeAuthInterceptor.ATTR_EMAIL);
		String userId = (String) attributes.get(HandshakeAuthInterceptor.ATTR_USER_ID);
		if (expectedHeader == null || expectedToken == null || email == null || userId == null) {
			throw new AccessDeniedException("unauthenticated WebSocket session");
		}
		String presented = stomp.getFirstNativeHeader(expectedHeader);
		if (!expectedToken.equals(presented)) {
			log.info("Rejected STOMP CONNECT without the CSRF binding for {}", email);
			throw new AccessDeniedException("CSRF token missing or invalid");
		}
		stomp.setUser(new RealtimeSessionRegistry.StompPrincipal(email));
		registry.connected(stomp.getSessionId(), UUID.fromString(userId), email);
	}

	private void authorizeSubscription(StompHeaderAccessor stomp) {
		String destination = stomp.getDestination();
		String sessionId = stomp.getSessionId();
		if (destination == null) {
			throw new AccessDeniedException("subscription without a destination");
		}
		RealtimeSessionRegistry.StompPrincipal principal = principal(stomp);
		UUID userId = userId(stomp);
		if (destination.startsWith(PROJECT_TOPIC_PREFIX)) {
			UUID projectId = parseId(destination.substring(PROJECT_TOPIC_PREFIX.length()));
			Project project = projectId == null ? null : projects.findById(projectId).orElse(null);
			if (project == null || !access.canRead(project, userId)) {
				throw new AccessDeniedException("not authorized for " + destination);
			}
			registry.subscribed(sessionId, projectId, true);
			return;
		}
		if (destination.startsWith(TEAM_TOPIC_PREFIX)) {
			UUID teamId = parseId(destination.substring(TEAM_TOPIC_PREFIX.length()));
			if (teamId == null || members.findMembership(teamId, userId).isEmpty()) {
				throw new AccessDeniedException("not authorized for " + destination);
			}
			registry.subscribed(sessionId, teamId, false);
			return;
		}
		throw new AccessDeniedException("unknown destination " + destination);
	}

	private static RealtimeSessionRegistry.StompPrincipal principal(StompHeaderAccessor stomp) {
		if (stomp.getUser() instanceof RealtimeSessionRegistry.StompPrincipal stompPrincipal) {
			return stompPrincipal;
		}
		throw new AccessDeniedException("unauthenticated WebSocket session");
	}

	private static UUID userId(StompHeaderAccessor stomp) {
		Map<String, Object> attributes = stomp.getSessionAttributes();
		Object userId = attributes == null ? null : attributes.get(HandshakeAuthInterceptor.ATTR_USER_ID);
		if (userId == null) {
			throw new AccessDeniedException("unauthenticated WebSocket session");
		}
		return UUID.fromString(userId.toString());
	}

	private static UUID parseId(String raw) {
		try {
			return UUID.fromString(raw);
		}
		catch (IllegalArgumentException ex) {
			return null;
		}
	}
}
