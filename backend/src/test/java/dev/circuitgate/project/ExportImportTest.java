package dev.circuitgate.project;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import dev.circuitgate.TestcontainersConfiguration;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.ContentDisposition;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ExportImportTest extends ProjectApiTestSupport {

	@Test
	void exportThenImportReproducesPayloadExactly() throws Exception {
		Client alice = client("exp-alice@example.com");
		Client bob = client("exp-bob@example.com");
		JsonNode original = document("round-trip");
		UUID sourceId = createProject(alice, "Round trip", original);

		MvcResult export = getJson("/api/projects/" + sourceId + "/export", alice.session()).andReturn();
		assertEquals(200, export.getResponse().getStatus(), export.getResponse().getContentAsString());
		JsonNode envelope = body(export);
		assertEquals("circuitgate-project", envelope.get("format").asText());
		assertEquals(1, envelope.get("schemaVersion").asInt());
		assertEquals(1, envelope.get("contentVersion").asLong());
		assertEquals("Round trip", envelope.get("name").asText());
		assertEquals(original, envelope.get("document"));
		assertNotNull(export.getResponse().getHeader("Content-Disposition"));

		MvcResult imported = postJson("/api/projects/import", envelope, bob).andReturn();
		assertEquals(201, imported.getResponse().getStatus(), imported.getResponse().getContentAsString());
		JsonNode importedBody = body(imported);
		UUID importedId = UUID.fromString(importedBody.get("id").asText());
		assertNotEquals(sourceId, importedId);
		assertEquals("Round trip", importedBody.get("name").asText());
		assertEquals(1, importedBody.get("version").asLong());
		assertEquals(original, importedBody.get("document"));

		assertEquals(userId("exp-bob@example.com"),
				jdbc.queryForObject("select owner_id from projects where id = ?", UUID.class, importedId));
		MvcResult read = getJson("/api/projects/" + importedId, bob.session()).andReturn();
		assertEquals(200, read.getResponse().getStatus());
		assertEquals(original, body(read).get("document"));
	}

	@Test
	void exportFilenameIsSanitized() throws Exception {
		Client alice = client("exp-filename@example.com");
		String malicious = "../../evil\"name\r\nX-Injected: yes";
		UUID id = createProject(alice, malicious, document("file"));

		MvcResult export = getJson("/api/projects/" + id + "/export", alice.session()).andReturn();
		assertEquals(200, export.getResponse().getStatus(), export.getResponse().getContentAsString());
		String header = export.getResponse().getHeader("Content-Disposition");
		assertNotNull(header, "export must carry a Content-Disposition header");
		String filename = ContentDisposition.parse(header).getFilename();
		assertEquals("evil-name-X-Injected-yes.circuitgate.json", filename);
		assertFalse(filename.contains(".."));
		assertFalse(header.contains("\r"));
		assertFalse(header.contains("\n"));
	}

	@Test
	void importRejectsMalformedEnvelope() throws Exception {
		String email = "imp-malformed@example.com";
		Client alice = client(email);
		JsonNode doc = document("x");

		List<Object> rejected = List.of(
				Map.of(),
				Map.of("format", "other", "schemaVersion", 1, "name", "x", "document", doc),
				Map.of("format", "circuitgate-project", "schemaVersion", 1, "name", "", "document", doc),
				Map.of("format", "circuitgate-project", "schemaVersion", 1, "document", doc),
				Map.of("format", "circuitgate-project", "schemaVersion", 1, "name", "x"),
				Map.of("format", "circuitgate-project", "schemaVersion", 1, "name", "x".repeat(201), "document", doc));
		for (Object body : rejected) {
			MvcResult result = postJson("/api/projects/import", body, alice).andReturn();
			assertEquals(400, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		}

		Map<String, Object> arrayDocument = new LinkedHashMap<>();
		arrayDocument.put("format", "circuitgate-project");
		arrayDocument.put("schemaVersion", 1);
		arrayDocument.put("name", "x");
		arrayDocument.put("document", objectMapper.createArrayNode());
		assertEquals(400, postJson("/api/projects/import", arrayDocument, alice).andReturn().getResponse().getStatus());

		assertEquals(0, projectCount(email));
	}

	@Test
	void importRejectsUnknownSchemaVersion() throws Exception {
		String email = "imp-schema@example.com";
		Client alice = client(email);
		MvcResult rejected = postJson("/api/projects/import",
				Map.of("format", "circuitgate-project", "schemaVersion", 2, "name", "x", "document", document("x")),
				alice).andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals("invalid_project_document", body(rejected).get("error").asText());
		assertEquals(0, projectCount(email));
	}

	@Test
	void importRejectsOversizedPayload() throws Exception {
		String email = "imp-oversized@example.com";
		Client alice = client(email);
		ObjectNode oversized = objectMapper.createObjectNode();
		oversized.put("blob", "x".repeat(2_200_000));
		MvcResult rejected = postJson("/api/projects/import", envelope("Big", oversized), alice).andReturn();
		assertEquals(413, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals(0, projectCount(email));
	}

	@Test
	void importRejectsOverDeepPayload() throws Exception {
		String email = "imp-deep@example.com";
		Client alice = client(email);
		MvcResult rejected = postJson("/api/projects/import", envelope("Deep", deepDocument(60)), alice).andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals(0, projectCount(email));
	}

	@Test
	void importRejectsOverLongString() throws Exception {
		String email = "imp-strings@example.com";
		Client alice = client(email);
		ObjectNode longString = objectMapper.createObjectNode();
		longString.put("label", "x".repeat(10_001));
		MvcResult rejected = postJson("/api/projects/import", envelope("Strings", longString), alice).andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals(0, projectCount(email));
	}

	@Test
	void importIgnoresServerOwnedFields() throws Exception {
		String email = "imp-owned@example.com";
		Client alice = client(email);
		JsonNode doc = document("attacker");
		UUID claimedId = UUID.randomUUID();

		ObjectNode envelope = objectMapper.createObjectNode();
		envelope.put("format", "circuitgate-project");
		envelope.put("schemaVersion", 1);
		envelope.put("contentVersion", 99);
		envelope.put("name", "Imported");
		envelope.set("document", doc);
		envelope.put("id", claimedId.toString());
		envelope.put("owner", "attacker@example.com");
		envelope.put("ownerId", UUID.randomUUID().toString());
		envelope.set("shares", objectMapper.createArrayNode());
		envelope.set("share", objectMapper.createObjectNode());
		envelope.set("lock", objectMapper.createObjectNode());
		envelope.put("createdAt", "2000-01-01T00:00:00Z");
		envelope.put("updatedAt", "2000-01-01T00:00:00Z");

		MvcResult imported = postJson("/api/projects/import", envelope, alice).andReturn();
		assertEquals(201, imported.getResponse().getStatus(), imported.getResponse().getContentAsString());
		JsonNode importedBody = body(imported);
		UUID createdId = UUID.fromString(importedBody.get("id").asText());
		assertNotEquals(claimedId, createdId);
		assertEquals(1, importedBody.get("version").asLong());
		assertEquals(doc, importedBody.get("document"));
		assertFalse(importedBody.has("owner"));
		assertFalse(importedBody.has("shares"));
		assertFalse(importedBody.has("share"));
		assertFalse(importedBody.has("lock"));

		assertEquals(userId(email),
				jdbc.queryForObject("select owner_id from projects where id = ?", UUID.class, createdId));
		assertEquals(1L,
				jdbc.queryForObject("select content_version from projects where id = ?", Long.class, createdId));
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
