package dev.circuitgate.realtime;

import java.io.IOException;
import java.security.Principal;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

@Component
public class RealtimeSessionRegistry {

	private static final Logger log = LoggerFactory.getLogger(RealtimeSessionRegistry.class);

	public record Subscription(UUID resourceId, boolean project) {
	}

	public record StompPrincipal(String email) implements Principal {

		@Override
		public String getName() {
			return email;
		}
	}

	private static final class SessionInfo {

		private final UUID userId;

		private final String email;

		private final Set<Subscription> subscriptions = ConcurrentHashMap.newKeySet();

		private SessionInfo(UUID userId, String email) {
			this.userId = userId;
			this.email = email;
		}
	}

	private final Map<String, SessionInfo> sessions = new ConcurrentHashMap<>();

	private final Map<String, WebSocketSession> sockets = new ConcurrentHashMap<>();

	public void socketEstablished(WebSocketSession socket) {
		sockets.put(socket.getId(), socket);
	}

	public void socketClosed(String sessionId) {
		sockets.remove(sessionId);
		sessions.remove(sessionId);
	}

	public void connected(String sessionId, UUID userId, String email) {
		sessions.put(sessionId, new SessionInfo(userId, email));
	}

	public void subscribed(String sessionId, UUID resourceId, boolean project) {
		SessionInfo info = sessions.get(sessionId);
		if (info != null) {
			info.subscriptions.add(new Subscription(resourceId, project));
		}
	}

	public void disconnectUser(String email) {
		if (email == null) {
			return;
		}
		sessions.entrySet()
			.stream()
			.filter(entry -> email.equalsIgnoreCase(entry.getValue().email))
			.map(Map.Entry::getKey)
			.toList()
			.forEach(this::close);
	}

	public void disconnectUsersFromProject(UUID projectId, Collection<UUID> userIds) {
		if (userIds.isEmpty()) {
			return;
		}
		Set<UUID> affected = Set.copyOf(userIds);
		sessions.entrySet()
			.stream()
			.filter(entry -> affected.contains(entry.getValue().userId))
			.filter(entry -> isSubscribed(entry.getValue(), projectId))
			.map(Map.Entry::getKey)
			.toList()
			.forEach(this::close);
	}

	public void disconnectUserFromProjects(UUID userId, Collection<UUID> projectIds) {
		if (projectIds.isEmpty()) {
			return;
		}
		Set<UUID> affectedProjects = Set.copyOf(projectIds);
		sessions.entrySet()
			.stream()
			.filter(entry -> entry.getValue().userId.equals(userId))
			.filter(entry -> entry.getValue().subscriptions.stream()
				.anyMatch(subscription -> subscription.project()
						&& affectedProjects.contains(subscription.resourceId())))
			.map(Map.Entry::getKey)
			.toList()
			.forEach(this::close);
	}

	public void disconnectSubscribers(UUID projectId, Set<UUID> excludedUserIds) {
		sessions.entrySet()
			.stream()
			.filter(entry -> !excludedUserIds.contains(entry.getValue().userId))
			.filter(entry -> isSubscribed(entry.getValue(), projectId))
			.map(Map.Entry::getKey)
			.toList()
			.forEach(this::close);
	}

	private static boolean isSubscribed(SessionInfo info, UUID projectId) {
		return info.subscriptions.stream().anyMatch(subscription -> subscription.project()
				&& subscription.resourceId().equals(projectId));
	}

	private void close(String sessionId) {
		WebSocketSession socket = sockets.get(sessionId);
		if (socket == null) {
			sessions.remove(sessionId);
			return;
		}
		try {
			socket.close(CloseStatus.NORMAL);
		}
		catch (IOException ex) {
			log.debug("Failed to close realtime session {}: {}", sessionId, ex.getMessage());
		}
	}

	public long subscriptionCount(UUID resourceId, boolean project) {
		return sessions.values()
			.stream()
			.filter(info -> info.subscriptions.stream()
				.anyMatch(subscription -> subscription.project() == project
						&& subscription.resourceId().equals(resourceId)))
			.count();
	}
}
