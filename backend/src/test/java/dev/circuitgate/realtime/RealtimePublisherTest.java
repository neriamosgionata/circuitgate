package dev.circuitgate.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import dev.circuitgate.realtime.RealtimeEvents.Event;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class RealtimePublisherTest {

	private static final class RecordingBroadcaster implements TopicBroadcaster {

		private final List<Sent> sent = new ArrayList<>();

		@Override
		public void send(String destination, Object payload) {
			sent.add(new Sent(destination, payload));
		}
	}

	private record Sent(String destination, Object payload) {
	}

	private final RecordingBroadcaster broadcaster = new RecordingBroadcaster();

	private final RealtimePublisher publisher = new RealtimePublisher(broadcaster);

	@AfterEach
	void clearSynchronization() {
		if (TransactionSynchronizationManager.isSynchronizationActive()) {
			TransactionSynchronizationManager.clearSynchronization();
		}
	}

	@Test
	void eventsPublishedInsideARolledBackTransactionAreNotBroadcast() {
		UUID projectId = UUID.randomUUID();
		TransactionSynchronizationManager.initSynchronization();
		publisher.publish(new Event.ProjectSaved(projectId, 2, UUID.randomUUID()));
		assertEquals(0, broadcaster.sent.size(), "an uncommitted transaction must not emit events");
		TransactionSynchronizationManager.clearSynchronization();
		assertEquals(0, broadcaster.sent.size(), "a rolled-back transaction must not emit events");
	}

	@Test
	void eventsAreBroadcastOnlyAfterCommit() {
		UUID projectId = UUID.randomUUID();
		UUID holderId = UUID.randomUUID();
		TransactionSynchronizationManager.initSynchronization();
		publisher.publish(new Event.LockChanged(projectId, 3, holderId, "holder@example.test", Instant.now(), true,
				"acquired"));
		assertEquals(0, broadcaster.sent.size());
		TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
		TransactionSynchronizationManager.clearSynchronization();

		assertEquals(1, broadcaster.sent.size());
		assertEquals("/topic/projects/" + projectId, broadcaster.sent.get(0).destination());
		assertTrue(broadcaster.sent.get(0).payload() instanceof java.util.Map<?, ?>);
		assertEquals("lock_changed", ((java.util.Map<?, ?>) broadcaster.sent.get(0).payload()).get("type"));
	}

	@Test
	void shareChangesReachBothTheProjectAndTheTeamTopic() {
		UUID projectId = UUID.randomUUID();
		UUID teamId = UUID.randomUUID();
		publisher.publish(new Event.ShareChanged(projectId, teamId, UUID.randomUUID(), true));

		assertEquals(List.of("/topic/projects/" + projectId, "/topic/teams/" + teamId),
				broadcaster.sent.stream().map(Sent::destination).toList());
	}

	@Test
	void membershipChangesReachTheTeamTopic() {
		UUID teamId = UUID.randomUUID();
		publisher.publish(new Event.TeamMembershipChanged(teamId, UUID.randomUUID(), false));

		assertEquals(List.of("/topic/teams/" + teamId),
				broadcaster.sent.stream().map(Sent::destination).toList());
	}

	@Test
	void eventsOutsideATransactionAreBroadcastImmediately() {
		UUID projectId = UUID.randomUUID();
		publisher.publish(new Event.ProjectDeleted(projectId, UUID.randomUUID()));

		assertEquals(List.of("/topic/projects/" + projectId),
				broadcaster.sent.stream().map(Sent::destination).toList());
	}
}
