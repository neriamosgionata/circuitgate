package dev.circuitgate.realtime;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import dev.circuitgate.realtime.RealtimeEvents.Event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Component
public class RealtimePublisher {

	private static final Logger log = LoggerFactory.getLogger(RealtimePublisher.class);

	private final TopicBroadcaster broadcaster;

	public RealtimePublisher(TopicBroadcaster broadcaster) {
		this.broadcaster = broadcaster;
	}

	public void publish(Event event) {
		runAfterCommit(() -> dispatch(event));
	}

	public void runAfterCommit(Runnable action) {
		if (TransactionSynchronizationManager.isSynchronizationActive()) {
			TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
				@Override
				public void afterCommit() {
					action.run();
				}
			});
		}
		else {
			action.run();
		}
	}

	void dispatch(Event event) {
		try {
			Map<String, Object> payload = payload(event);
			if (event instanceof Event.ProjectSaved projectSaved) {
				broadcaster.send(projectTopic(projectSaved.projectId()), payload);
			}
			else if (event instanceof Event.ProjectDeleted projectDeleted) {
				broadcaster.send(projectTopic(projectDeleted.projectId()), payload);
			}
			else if (event instanceof Event.LockChanged lockChanged) {
				broadcaster.send(projectTopic(lockChanged.projectId()), payload);
			}
			else if (event instanceof Event.ShareChanged shareChanged) {
				broadcaster.send(projectTopic(shareChanged.projectId()), payload);
				broadcaster.send(teamTopic(shareChanged.teamId()), payload);
			}
			else if (event instanceof Event.TeamMembershipChanged membershipChanged) {
				broadcaster.send(teamTopic(membershipChanged.teamId()), payload);
			}
		}
		catch (RuntimeException ex) {
			log.warn("Realtime broadcast failed for {}: {}", event.type(), ex.getMessage());
		}
	}

	static Map<String, Object> payload(Event event) {
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("type", event.type());
		if (event instanceof Event.ProjectSaved saved) {
			payload.put("projectId", saved.projectId());
			payload.put("version", saved.version());
			payload.put("actorId", saved.actorId());
		}
		else if (event instanceof Event.ProjectDeleted deleted) {
			payload.put("projectId", deleted.projectId());
			payload.put("actorId", deleted.actorId());
		}
		else if (event instanceof Event.LockChanged lock) {
			payload.put("projectId", lock.projectId());
			payload.put("epoch", lock.epoch());
			payload.put("holderId", lock.holderId());
			payload.put("holderEmail", lock.holderEmail());
			payload.put("expiresAt", lock.expiresAt());
			payload.put("locked", lock.locked());
			payload.put("reason", lock.reason());
		}
		else if (event instanceof Event.ShareChanged share) {
			payload.put("projectId", share.projectId());
			payload.put("teamId", share.teamId());
			payload.put("actorId", share.actorId());
			payload.put("shared", share.shared());
		}
		else if (event instanceof Event.TeamMembershipChanged membership) {
			payload.put("teamId", membership.teamId());
			payload.put("userId", membership.userId());
			payload.put("member", membership.member());
		}
		return payload;
	}

	public static String projectTopic(UUID projectId) {
		return "/topic/projects/" + projectId;
	}

	public static String teamTopic(UUID teamId) {
		return "/topic/teams/" + teamId;
	}
}
