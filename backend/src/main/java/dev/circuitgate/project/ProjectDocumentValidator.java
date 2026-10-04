package dev.circuitgate.project;

import dev.circuitgate.config.CircuitGateProperties;
import dev.circuitgate.project.dto.ProjectDtos.ImportRequest;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import org.springframework.stereotype.Component;

@Component
public class ProjectDocumentValidator {

	static final String FORMAT = "circuitgate-project";

	static final int MAX_NAME_LENGTH = 200;

	private final ObjectMapper objectMapper;

	private final CircuitGateProperties properties;

	public ProjectDocumentValidator(ObjectMapper objectMapper, CircuitGateProperties properties) {
		this.objectMapper = objectMapper;
		this.properties = properties;
	}

	public ValidatedProject validate(String name, Integer schemaVersion, JsonNode document) {
		return new ValidatedProject(validateName(name), validateSchemaVersion(schemaVersion),
				validateDocument(document));
	}

	public ValidatedProject validateImport(ImportRequest request) {
		if (request == null || !FORMAT.equals(request.format())) {
			throw new InvalidProjectDocumentException();
		}
		return validate(request.name(), request.schemaVersion(), request.document());
	}

	private String validateName(String name) {
		if (name == null) {
			throw new InvalidProjectDocumentException();
		}
		String trimmed = name.strip();
		if (trimmed.isEmpty() || trimmed.length() > MAX_NAME_LENGTH) {
			throw new InvalidProjectDocumentException();
		}
		return trimmed;
	}

	private int validateSchemaVersion(Integer schemaVersion) {
		if (schemaVersion == null || schemaVersion != properties.getProjects().getSchemaVersion()) {
			throw new InvalidProjectDocumentException();
		}
		return schemaVersion;
	}

	private JsonNode validateDocument(JsonNode document) {
		if (document == null || document.isNull() || !document.isObject()) {
			throw new InvalidProjectDocumentException();
		}
		int maxBytes = (int) properties.getProjects().getMaxDocumentBytes().toBytes();
		try {
			if (objectMapper.writeValueAsBytes(document).length > maxBytes) {
				throw new ProjectPayloadTooLargeException();
			}
		}
		catch (JacksonException ex) {
			throw new InvalidProjectDocumentException();
		}
		if (exceedsDepth(document, 1, properties.getProjects().getMaxDepth())
				|| containsOversizedText(document, properties.getProjects().getMaxStringLength())) {
			throw new InvalidProjectDocumentException();
		}
		return document;
	}

	private boolean exceedsDepth(JsonNode node, int depth, int maxDepth) {
		if (depth > maxDepth) {
			return true;
		}
		if (node.isObject() || node.isArray()) {
			for (JsonNode child : node) {
				if (exceedsDepth(child, depth + 1, maxDepth)) {
					return true;
				}
			}
		}
		return false;
	}

	private boolean containsOversizedText(JsonNode node, int maxLength) {
		if (node.isTextual()) {
			return node.asText().length() > maxLength;
		}
		for (JsonNode child : node) {
			if (containsOversizedText(child, maxLength)) {
				return true;
			}
		}
		return false;
	}

	public record ValidatedProject(String name, int schemaVersion, JsonNode document) {
	}
}
