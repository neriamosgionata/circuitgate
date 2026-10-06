package dev.circuitgate.project;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.UUID;

import dev.circuitgate.TestcontainersConfiguration;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AnalogDocumentAcceptanceTest extends ProjectApiTestSupport {

	@Test
	void acceptsAnAnalogDocumentWithinLimits() throws Exception {
		Client alice = client("analog-accept@example.com");
		ObjectNode document = analogDocument();

		MvcResult created = postJson("/api/projects", createBody("Analog divider", document), alice).andReturn();
		assertEquals(201, created.getResponse().getStatus(), created.getResponse().getContentAsString());
		UUID id = UUID.fromString(body(created).get("id").asText());

		MvcResult read = getJson("/api/projects/" + id, alice.session()).andReturn();
		assertEquals(200, read.getResponse().getStatus(), read.getResponse().getContentAsString());
		JsonNode stored = body(read).get("document");
		assertEquals("analog", stored.get("circuit").get("domain").asText());
		assertEquals(2, stored.get("circuit").get("models").size());
		assertEquals(3, stored.get("circuit").get("analyses").size());
		assertEquals(document, stored);

		MvcResult saved = putJson("/api/projects/" + id, saveBody("Analog divider", document, 1), alice)
			.andReturn();
		assertEquals(200, saved.getResponse().getStatus(), saved.getResponse().getContentAsString());

		MvcResult export = getJson("/api/projects/" + id + "/export", alice.session()).andReturn();
		assertEquals(200, export.getResponse().getStatus());
		assertEquals(document, body(export).get("document"));
	}

	@Test
	void rejectsAnOversizedModelString() throws Exception {
		String email = "analog-model-oversize@example.com";
		Client alice = client(email);
		ObjectNode document = analogDocument();
		((ObjectNode) document.get("circuit").get("models").get(0)).put("source", "x".repeat(10_001));

		MvcResult rejected = postJson("/api/projects", createBody("Oversized model", document), alice)
			.andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals("invalid_project_document", body(rejected).get("error").asText());
		assertEquals(0, projectCount(email));
	}

	@Test
	void rejectsAnOverDeepAnalogDocument() throws Exception {
		String email = "analog-deep@example.com";
		Client alice = client(email);
		ObjectNode document = analogDocument();
		ObjectNode cursor = (ObjectNode) document.get("circuit");
		for (int index = 0; index < 60; index += 1) {
			ObjectNode child = objectMapper.createObjectNode();
			cursor.set("nested", child);
			cursor = child;
		}

		MvcResult rejected = postJson("/api/projects", createBody("Deep analog", document), alice).andReturn();
		assertEquals(400, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals("invalid_project_document", body(rejected).get("error").asText());
		assertEquals(0, projectCount(email));
	}

	@Test
	void rejectsAnAnalogDocumentOverThePayloadLimit() throws Exception {
		String email = "analog-payload@example.com";
		Client alice = client(email);
		ObjectNode document = analogDocument();
		ArrayNode models = (ArrayNode) document.get("circuit").get("models");
		for (int index = 0; index < 300; index += 1) {
			ObjectNode model = objectMapper.createObjectNode();
			model.put("name", "m" + index);
			model.put("formatVersion", 1);
			model.put("source", "x".repeat(9_999));
			models.add(model);
		}

		MvcResult rejected = postJson("/api/projects", createBody("Big analog", document), alice).andReturn();
		assertEquals(413, rejected.getResponse().getStatus(), rejected.getResponse().getContentAsString());
		assertEquals(0, projectCount(email));
	}

	private ObjectNode analogDocument() {
		ObjectNode circuit = objectMapper.createObjectNode();
		circuit.put("schemaVersion", 1);
		circuit.put("domain", "analog");

		ArrayNode components = circuit.putArray("components");
		components.add(component("v1", "vsource"));
		components.add(component("r1", "resistor"));

		ArrayNode models = circuit.putArray("models");
		models.add(model("d1n4148", 1, ".model d1n4148 d(is=2.52e-9 rs=0.568 n=1.752 cjo=4e-12 tt=11.54e-9)"));
		models.add(model("opamp741", 1,
				".subckt opamp741 inp inn out vcc vee\nrin inp inn 2meg\neout out 0 inp inn 200000\n.ends opamp741"));

		ArrayNode analyses = circuit.putArray("analyses");
		analyses.add(analysis("op1", "op"));
		analyses.add(analysis("tran1", "tran"));
		analyses.add(analysis("ac1", "ac"));

		ObjectNode document = objectMapper.createObjectNode();
		document.set("circuit", circuit);
		document.set("definitions", objectMapper.createObjectNode());
		ObjectNode layouts = objectMapper.createObjectNode();
		layouts.set("", objectMapper.createObjectNode());
		document.set("layouts", layouts);
		return document;
	}

	private ObjectNode component(String id, String kind) {
		ObjectNode component = objectMapper.createObjectNode();
		component.put("id", id);
		component.put("kind", kind);
		component.set("inputs", objectMapper.createObjectNode());
		component.set("outputs", objectMapper.createObjectNode());
		return component;
	}

	private ObjectNode model(String name, int formatVersion, String source) {
		ObjectNode model = objectMapper.createObjectNode();
		model.put("name", name);
		model.put("formatVersion", formatVersion);
		model.put("source", source);
		return model;
	}

	private ObjectNode analysis(String id, String kind) {
		ObjectNode analysis = objectMapper.createObjectNode();
		analysis.put("id", id);
		analysis.put("kind", kind);
		analysis.set("params", objectMapper.createObjectNode());
		return analysis;
	}
}
