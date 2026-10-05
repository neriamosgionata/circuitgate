package dev.circuitgate.project;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import dev.circuitgate.TestcontainersConfiguration;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ProjectVersioningTest extends ProjectApiTestSupport {

	@Test
	void staleSaveIsRejectedAsConflictWithoutChangingContent() throws Exception {
		String email = "ver-alice@example.com";
		Client alice = client(email);
		UUID id = createProject(alice, "Race", document("v1"));
		JsonNode second = document("v2");
		assertEquals(200,
				putJson("/api/projects/" + id, saveBody("Race", second, 1), alice).andReturn().getResponse().getStatus());

		JsonNode stale = document("stale");
		MvcResult conflict = putJson("/api/projects/" + id, saveBody("Race", stale, 1), alice).andReturn();
		assertEquals(409, conflict.getResponse().getStatus(), conflict.getResponse().getContentAsString());
		JsonNode conflictBody = body(conflict);
		assertEquals("conflict", conflictBody.get("error").asText());
		assertEquals(2, conflictBody.get("version").asLong());

		MvcResult read = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(2, body(read).get("version").asLong());
		assertEquals(second, body(read).get("document"));
		assertEquals(1, projectCount(email));
	}

	@Test
	void saveAfterDeleteFailsWithoutCreatingRow() throws Exception {
		String email = "ver-delete@example.com";
		Client alice = client(email);
		UUID id = createProject(alice, "Gone", document("v1"));
		assertEquals(204, deleteProject("/api/projects/" + id, alice).andReturn().getResponse().getStatus());

		MvcResult save = putJson("/api/projects/" + id, saveBody("Gone", document("v2"), 1), alice).andReturn();
		assertEquals(404, save.getResponse().getStatus(), save.getResponse().getContentAsString());
		assertEquals(0, projectCount(email));
	}

	@Test
	void eachSaveIncrementsVersion() throws Exception {
		Client alice = client("ver-increment@example.com");
		UUID id = createProject(alice, "Counter", document("v1"));
		for (long expected = 1; expected <= 3; expected++) {
			MvcResult saved = putJson("/api/projects/" + id,
					saveBody("Counter", document("v" + (expected + 1)), expected), alice).andReturn();
			assertEquals(200, saved.getResponse().getStatus(), saved.getResponse().getContentAsString());
			assertEquals(expected + 1, body(saved).get("version").asLong());
		}
		MvcResult read = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(4, body(read).get("version").asLong());
	}

	@Test
	void concurrentSavesWithSameExpectedVersionYieldOneWinner() throws Exception {
		Client alice = client("ver-race@example.com");
		UUID id = createProject(alice, "Race", document("v1"));

		ExecutorService pool = Executors.newFixedThreadPool(2);
		CountDownLatch start = new CountDownLatch(1);
		List<Future<Integer>> futures = new ArrayList<>();
		for (int i = 0; i < 2; i++) {
			JsonNode contender = document("race-" + i);
			futures.add(pool.submit(() -> {
				start.await();
				return putJson("/api/projects/" + id, saveBody("Race", contender, 1), alice).andReturn()
					.getResponse()
					.getStatus();
			}));
		}
		start.countDown();
		List<Integer> statuses = new ArrayList<>();
		for (Future<Integer> future : futures) {
			statuses.add(future.get(30, TimeUnit.SECONDS));
		}
		pool.shutdownNow();

		statuses.sort(Integer::compareTo);
		assertEquals(List.of(200, 409), statuses);
		MvcResult read = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(2, body(read).get("version").asLong());
	}

	@Test
	void unknownSchemaVersionIsRejectedOnSave() throws Exception {
		Client alice = client("ver-schema@example.com");
		UUID id = createProject(alice, "Schema", document("v1"));
		MvcResult rejected = putJson("/api/projects/" + id,
				Map.of("name", "Schema", "schemaVersion", 2, "version", 1, "document", document("v2")), alice)
			.andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals("invalid_project_document", body(rejected).get("error").asText());

		MvcResult read = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(1, body(read).get("version").asLong());
		assertEquals(document("v1"), body(read).get("document"));
	}

	@Test
	void oversizedSaveIsRejected() throws Exception {
		Client alice = client("ver-oversized@example.com");
		UUID id = createProject(alice, "Big", document("v1"));
		ObjectNode oversized = objectMapper.createObjectNode();
		oversized.put("blob", "x".repeat(2_200_000));
		MvcResult rejected = putJson("/api/projects/" + id, saveBody("Big", oversized, 1), alice).andReturn();
		assertEquals(413, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals(1, body(getJson("/api/projects/" + id, alice.session()).andReturn()).get("version").asLong());
	}

	@Test
	void overDeepSaveIsRejected() throws Exception {
		Client alice = client("ver-deep@example.com");
		UUID id = createProject(alice, "Deep", document("v1"));
		MvcResult rejected = putJson("/api/projects/" + id, saveBody("Deep", deepDocument(60), 1), alice).andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals("invalid_project_document", body(rejected).get("error").asText());
		assertEquals(1, body(getJson("/api/projects/" + id, alice.session()).andReturn()).get("version").asLong());
	}

	@Test
	void overLongStringSaveIsRejected() throws Exception {
		Client alice = client("ver-strings@example.com");
		UUID id = createProject(alice, "Strings", document("v1"));
		ObjectNode longString = objectMapper.createObjectNode();
		longString.put("label", "x".repeat(10_001));
		MvcResult rejected = putJson("/api/projects/" + id, saveBody("Strings", longString, 1), alice).andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals(1, body(getJson("/api/projects/" + id, alice.session()).andReturn()).get("version").asLong());
	}

	private JsonNode deepDocument(int depth) {
		ObjectNode root = objectMapper.createObjectNode();
		ObjectNode cursor = root;
		for (int i = 1; i < depth; i++) {
			ObjectNode child = objectMapper.createObjectNode();
			cursor.set("nested", child);
			cursor = child;
		}
		return root;
	}
}
