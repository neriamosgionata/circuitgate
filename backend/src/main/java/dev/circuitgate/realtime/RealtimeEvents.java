package dev.circuitgate.realtime;

import java.time.Instant;
import java.util.UUID;

public final class RealtimeEvents {

	private RealtimeEvents() {
	}

	public sealed interface Event
			permits Event.ProjectSaved, Event.ProjectDeleted, Event.LockChanged, Event.ShareChanged,
			Event.TeamMembershipChanged {

		String type();

		record ProjectSaved(UUID projectId, long version, UUID actorId) implements Event {

			@Override
			public String type() {
				return "project_saved";
			}
		}

		record ProjectDeleted(UUID projectId, UUID actorId) implements Event {

			@Override
			public String type() {
				return "project_deleted";
			}
		}

		record LockChanged(UUID projectId, long epoch, UUID holderId, String holderEmail, Instant expiresAt,
				boolean locked, String reason) implements Event {

			@Override
			public String type() {
				return "lock_changed";
			}
		}

		record ShareChanged(UUID projectId, UUID teamId, UUID actorId, boolean shared) implements Event {

			@Override
			public String type() {
				return "share_changed";
			}
		}

		record TeamMembershipChanged(UUID teamId, UUID userId, boolean member) implements Event {

			@Override
			public String type() {
				return "team_membership_changed";
			}
		}
	}
}
