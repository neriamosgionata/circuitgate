package dev.circuitgate.project;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import dev.circuitgate.TestcontainersConfiguration;

import tools.jackson.databind.JsonNode;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ProjectCrudTest extends ProjectApiTestSupport {

	@Test
	void createListReadUpdateDeleteOwnProject() throws Exception {
		String email = "crud-alice@example.com";
		Client alice = client(email);
		JsonNode original = document("alu-v1");
		UUID id = createProject(alice, "ALU", original);

		MvcResult list = getJson("/api/projects", alice.session()).andReturn();
		assertEquals(200, list.getResponse().getStatus(), list.getResponse().getContentAsString());
		JsonNode listBody = body(list);
		assertTrue(listBody.isArray(), "list must return an array");
		assertTrue(hasProjectId(listBody, id), "own project must appear in the list");

		MvcResult read = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(200, read.getResponse().getStatus(), read.getResponse().getContentAsString());
		JsonNode readBody = body(read);
		assertEquals("ALU", readBody.get("name").asText());
		assertEquals(1, readBody.get("version").asLong());
		assertEquals(1, readBody.get("schemaVersion").asInt());
		assertEquals(original, readBody.get("document"));

		JsonNode updated = document("alu-v2");
		MvcResult save = putJson("/api/projects/" + id, saveBody("ALU v2", updated, 1), alice).andReturn();
		assertEquals(200, save.getResponse().getStatus(), save.getResponse().getContentAsString());
		JsonNode savedBody = body(save);
		assertEquals(2, savedBody.get("version").asLong());
		assertEquals("ALU v2", savedBody.get("name").asText());
		assertEquals(updated, savedBody.get("document"));

		MvcResult deleteResult = deleteProject("/api/projects/" + id, alice).andReturn();
		assertEquals(204, deleteResult.getResponse().getStatus(), deleteResult.getResponse().getContentAsString());
		assertEquals(404, getJson("/api/projects/" + id, alice.session()).andReturn().getResponse().getStatus());
		assertFalse(hasProjectId(body(getJson("/api/projects", alice.session()).andReturn()), id));
	}

	@Test
	void anotherUsersProjectIsInaccessibleByEveryEndpoint() throws Exception {
		Client alice = client("crud-alice-2@example.com");
		Client bob = client("crud-bob@example.com");
		UUID id = createProject(alice, "Private", document("secret"));

		assertEquals(404, getJson("/api/projects/" + id, bob.session()).andReturn().getResponse().getStatus());
		MvcResult save = putJson("/api/projects/" + id, saveBody("Stolen", document("stolen"), 1), bob).andReturn();
		assertEquals(404, save.getResponse().getStatus(), save.getResponse().getContentAsString());
		assertEquals(404, deleteProject("/api/projects/" + id, bob).andReturn().getResponse().getStatus());
		assertEquals(404,
				getJson("/api/projects/" + id + "/export", bob.session()).andReturn().getResponse().getStatus());
		assertFalse(hasProjectId(body(getJson("/api/projects", bob.session()).andReturn()), id));

		MvcResult stillThere = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(200, stillThere.getResponse().getStatus());
		assertEquals(1, body(stillThere).get("version").asLong());
	}

	@Test
	void unauthenticatedRequestsAreRejected() throws Exception {
		Csrf anonymous = fetchCsrf(null);
		UUID id = UUID.randomUUID();

		assertEquals(401, getJson("/api/projects", null).andReturn().getResponse().getStatus());
		assertEquals(401, getJson("/api/projects/" + id, null).andReturn().getResponse().getStatus());
		assertEquals(401, getJson("/api/projects/" + id + "/export", null).andReturn().getResponse().getStatus());
		assertEquals(401, postJson("/api/projects", createBody("x", document("x")), anonymous.session(), anonymous)
			.andReturn().getResponse().getStatus());
		assertEquals(401, mvc.perform(put("/api/projects/" + id).contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(saveBody("x", document("x"), 1)))
			.cookie(anonymous.session())
			.header(anonymous.headerName(), anonymous.token())).andReturn().getResponse().getStatus());
		assertEquals(401, mvc.perform(delete("/api/projects/" + id).cookie(anonymous.session())
			.header(anonymous.headerName(), anonymous.token())).andReturn().getResponse().getStatus());
		assertEquals(401, postJson("/api/projects/import", envelope("x", document("x")), anonymous.session(), anonymous)
			.andReturn().getResponse().getStatus());
	}

	@Test
	void invalidCreateRequestsAreRejectedWithoutPersisting() throws Exception {
		String email = "crud-alice-3@example.com";
		Client alice = client(email);
		JsonNode doc = document("x");

		Map<String, Object> blankName = new LinkedHashMap<>();
		blankName.put("name", "  ");
		blankName.put("schemaVersion", 1);
		blankName.put("document", doc);
		assertEquals(400, postJson("/api/projects", blankName, alice).andReturn().getResponse().getStatus());

		MvcResult unknownSchema = postJson("/api/projects",
				Map.of("name", "x", "schemaVersion", 2, "document", doc), alice).andReturn();
		assertEquals(400, unknownSchema.getResponse().getStatus(), unknownSchema.getResponse().getContentAsString());

		Map<String, Object> arrayDocument = new LinkedHashMap<>();
		arrayDocument.put("name", "x");
		arrayDocument.put("schemaVersion", 1);
		arrayDocument.put("document", objectMapper.createArrayNode());
		assertEquals(400, postJson("/api/projects", arrayDocument, alice).andReturn().getResponse().getStatus());

		assertEquals(0, projectCount(email));
	}

	@Test
	void malformedProjectIdIsRejected() throws Exception {
		Client alice = client("crud-alice-5@example.com");
		assertEquals(400,
				getJson("/api/projects/not-a-uuid", alice.session()).andReturn().getResponse().getStatus());
	}

	@Test
	void stateChangingRequestsRequireCsrfToken() throws Exception {
		String email = "crud-alice-4@example.com";
		Client alice = client(email);
		MvcResult missing = mvc.perform(post("/api/projects").contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(createBody("No CSRF", document("x"))))
			.cookie(alice.session())).andReturn();
		assertEquals(403, missing.getResponse().getStatus(), missing.getResponse().getContentAsString());
		assertEquals(0, projectCount(email));
	}

	private boolean hasProjectId(JsonNode list, UUID id) {
		for (JsonNode item : list) {
			if (id.toString().equals(item.get("id").asText())) {
				return true;
			}
		}
		return false;
	}
}
