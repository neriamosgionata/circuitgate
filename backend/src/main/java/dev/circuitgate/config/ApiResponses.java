package dev.circuitgate.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.MediaType;

import tools.jackson.databind.ObjectMapper;

public final class ApiResponses {

	private ApiResponses() {
	}

	public static void write(HttpServletResponse response, ObjectMapper objectMapper, int status, Object body)
			throws IOException {
		response.setStatus(status);
		response.setContentType(MediaType.APPLICATION_JSON_VALUE);
		response.setCharacterEncoding(StandardCharsets.UTF_8.name());
		objectMapper.writeValue(response.getWriter(), body);
	}
}
