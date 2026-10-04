package dev.circuitgate.lock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import dev.circuitgate.TestcontainersConfiguration;
import dev.circuitgate.support.ProjectFeatureTestSupport;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class LockLifecycleTest extends ProjectFeatureTestSupport {

	@Autowired
	LockSweeper sweeper;

	private static String unique(String local) {
		return local + "-" + UUID.randomUUID() + "@example.test";
	}

	private record Scenario(Client owner, Client first, Client second, UUID firstId, UUID secondId, UUID projectId) {
	}

	private Scenario scenario(String label) throws Exception {
		String ownerEmail = unique(label + "-owner");
		String firstEmail = unique(label + "-first");
		String secondEmail = unique(label + "-second");
		Client owner = client(ownerEmail);
		Client first = client(firstEmail);
		Client second = client(secondEmail);
		UUID projectId = createProject(owner, label + "-project");
		UUID teamId = createTeam(owner, label + "-team");
		addMember(owner, teamId, firstEmail);
		addMember(owner, teamId, secondEmail);
		assertEquals(201, share(owner, projectId, teamId).getResponse().getStatus());
		return new Scenario(owner, first, second, userId(firstEmail), userId(secondEmail), projectId);
	}

	@Test
	void firstEditorHoldsTheLockAndTheSecondSeesBusyUntilRelease() throws Exception {
		Scenario scenario = scenario("ae3");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());

		MvcResult busy = acquire(scenario.second(), scenario.projectId());
		assertEquals(409, busy.getResponse().getStatus(), busy.getResponse().getContentAsString());
		assertEquals("locked", body(busy).get("error").asText());
		assertEquals(scenario.firstId().toString(), body(busy).get("lock").get("holderId").asText());
		assertTrue(body(busy).get("lock").get("locked").asBoolean());

		MvcResult state = getJson("/api/projects/" + scenario.projectId() + "/lock", scenario.second().session())
			.andReturn();
		assertEquals(200, state.getResponse().getStatus());
		assertTrue(body(state).get("locked").asBoolean());
		assertFalse(body(state).get("holder").asBoolean());

		assertEquals(204, releaseLock(scenario.first(), scenario.projectId(), epoch).getResponse().getStatus());

		long secondEpoch = acquireEpoch(scenario.second(), scenario.projectId());
		assertEquals(epoch + 2, secondEpoch,
				"release bumps the epoch once, the successor acquisition bumps it again");
	}

	@Test
	void twoSimultaneousAcquisitionsYieldExactlyOneWinner() throws Exception {
		Scenario scenario = scenario("race");
		ExecutorService pool = Executors.newFixedThreadPool(2);
		try {
			Callable<Integer> first = () -> acquire(scenario.first(), scenario.projectId()).getResponse().getStatus();
			Callable<Integer> second = () -> acquire(scenario.second(), scenario.projectId()).getResponse().getStatus();
			Future<Integer> firstResult = pool.submit(first);
			Future<Integer> secondResult = pool.submit(second);
			List<Integer> statuses = List.of(firstResult.get(30, TimeUnit.SECONDS),
					secondResult.get(30, TimeUnit.SECONDS));
			assertEquals(1, statuses.stream().filter(status -> status == 201).count(),
					"exactly one acquisition must win, statuses=" + statuses);
			assertEquals(1, statuses.stream().filter(status -> status == 409).count(),
					"the loser must see busy, statuses=" + statuses);
		}
		finally {
			pool.shutdownNow();
		}
		assertTrue(lockActive(scenario.projectId()));
		assertEquals(1, lockEpoch(scenario.projectId()));
	}

	@Test
	void expiredLockIsImmediatelyAcquirableEvenBeforeTheSweeper() throws Exception {
		Scenario scenario = scenario("expiry");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());
		expireLock(scenario.projectId());

		long secondEpoch = acquireEpoch(scenario.second(), scenario.projectId());
		assertEquals(epoch + 1, secondEpoch);
		assertTrue(lockActiveFor(scenario.projectId(), scenario.secondId()));
	}

	@Test
	void staleReleaseAndHeartbeatCannotTouchTheSuccessorsLock() throws Exception {
		Scenario scenario = scenario("stale");
		long staleEpoch = acquireEpoch(scenario.first(), scenario.projectId());
		expireLock(scenario.projectId());
		long successorEpoch = acquireEpoch(scenario.second(), scenario.projectId());

		MvcResult staleRelease = releaseLock(scenario.first(), scenario.projectId(), staleEpoch);
		assertEquals(409, staleRelease.getResponse().getStatus(), staleRelease.getResponse().getContentAsString());
		assertEquals("lock_conflict", body(staleRelease).get("error").asText());
		MvcResult staleHeartbeat = heartbeat(scenario.first(), scenario.projectId(), staleEpoch);
		assertEquals(409, staleHeartbeat.getResponse().getStatus(), staleHeartbeat.getResponse().getContentAsString());

		assertTrue(lockActiveFor(scenario.projectId(), scenario.secondId()));
		assertEquals(successorEpoch, lockEpoch(scenario.projectId()));
	}

	@Test
	void heartbeatAfterExpiryFailsWithoutResurrection() throws Exception {
		Scenario scenario = scenario("heartbeat-expiry");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());
		expireLock(scenario.projectId());

		MvcResult heartbeat = heartbeat(scenario.first(), scenario.projectId(), epoch);
		assertEquals(409, heartbeat.getResponse().getStatus(), heartbeat.getResponse().getContentAsString());
		assertFalse(lockActive(scenario.projectId()), "an expired lock must not be resurrected by a heartbeat");
	}

	@Test
	void heartbeatAndReleaseFromANonHolderAreRejected() throws Exception {
		Scenario scenario = scenario("non-holder");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());

		MvcResult heartbeat = heartbeat(scenario.second(), scenario.projectId(), epoch);
		assertEquals(409, heartbeat.getResponse().getStatus(), heartbeat.getResponse().getContentAsString());
		MvcResult release = releaseLock(scenario.second(), scenario.projectId(), epoch);
		assertEquals(409, release.getResponse().getStatus(), release.getResponse().getContentAsString());

		assertTrue(lockActiveFor(scenario.projectId(), scenario.firstId()));
	}

	@Test
	void aSecondTabOfTheSameUserIsReadOnly() throws Exception {
		Scenario scenario = scenario("second-tab");
		acquireEpoch(scenario.first(), scenario.projectId());

		Client secondTab = new Client(scenario.first().session(), scenario.first().csrf());
		MvcResult busy = acquire(secondTab, scenario.projectId());
		assertEquals(409, busy.getResponse().getStatus(), busy.getResponse().getContentAsString());
		assertEquals("locked", body(busy).get("error").asText());

		MvcResult state = getJson("/api/projects/" + scenario.projectId() + "/lock", scenario.first().session())
			.andReturn();
		assertTrue(body(state).get("locked").asBoolean());
		assertTrue(body(state).get("holder").asBoolean(),
				"the holder flag reflects the user, so the client relies on its own acquisition result for tabs");
	}

	@Test
	void savingDoesNotReleaseTheLock() throws Exception {
		Scenario scenario = scenario("save-keeps-lock");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());
		MvcResult saved = putJson("/api/projects/" + scenario.projectId(),
				saveBody("save-keeps-lock", document("first-edit"), 1, epoch), scenario.first())
			.andReturn();
		assertEquals(200, saved.getResponse().getStatus(), saved.getResponse().getContentAsString());

		assertTrue(lockActiveFor(scenario.projectId(), scenario.firstId()));
		assertEquals(epoch, lockEpoch(scenario.projectId()));

		MvcResult heartbeat = heartbeat(scenario.first(), scenario.projectId(), epoch);
		assertEquals(200, heartbeat.getResponse().getStatus(), heartbeat.getResponse().getContentAsString());
		assertEquals(epoch, lockEpoch(scenario.projectId()), "a heartbeat must not change the epoch");
	}

	@Test
	void savingAfterExpiryReturnsAConflictWithTheLatestVersion() throws Exception {
		Scenario scenario = scenario("save-expired");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());
		MvcResult firstSave = putJson("/api/projects/" + scenario.projectId(),
				saveBody("save-expired", document("first-edit"), 1, epoch), scenario.first())
			.andReturn();
		assertEquals(200, firstSave.getResponse().getStatus(), firstSave.getResponse().getContentAsString());
		assertEquals(2, body(firstSave).get("version").asLong());
		expireLock(scenario.projectId());

		MvcResult expiredSave = putJson("/api/projects/" + scenario.projectId(),
				saveBody("save-expired", document("second-edit"), 2, epoch), scenario.first())
			.andReturn();
		assertEquals(409, expiredSave.getResponse().getStatus(), expiredSave.getResponse().getContentAsString());
		assertEquals("lock_conflict", body(expiredSave).get("error").asText());
		assertEquals(2, body(expiredSave).get("version").asLong(),
				"the conflict must carry the latest version so the client can keep its draft");

		long successorEpoch = acquireEpoch(scenario.second(), scenario.projectId());
		assertEquals(epoch + 1, successorEpoch);
	}

	@Test
	void sweeperReleasesOverdueLocksAndBumpsTheEpoch() throws Exception {
		Scenario scenario = scenario("sweeper");
		long epoch = acquireEpoch(scenario.first(), scenario.projectId());
		expireLock(scenario.projectId());

		List<LockTransition> transitions = sweeper.sweep();

		assertTrue(transitions.stream().anyMatch(transition -> transition.projectId().equals(scenario.projectId())));
		assertFalse(lockActive(scenario.projectId()), "the sweeper must release an overdue lock");
		assertEquals(epoch + 1, lockEpoch(scenario.projectId()));
	}

	@Test
	void ownersOfUnsharedProjectsSaveWithoutALock() throws Exception {
		String ownerEmail = unique("unshared-owner");
		Client owner = client(ownerEmail);
		UUID projectId = createProject(owner, "unshared");

		MvcResult saved = putJson("/api/projects/" + projectId, saveBody("unshared", document("edit"), 1), owner)
			.andReturn();
		assertEquals(200, saved.getResponse().getStatus(), saved.getResponse().getContentAsString());
	}
}
