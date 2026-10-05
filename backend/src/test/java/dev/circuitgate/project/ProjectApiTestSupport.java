package dev.circuitgate.project;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import jakarta.servlet.http.Cookie;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

class ProjectApiTestSupport {

	static final String PASSWORD = "correct-horse-9";
	static final String SESSION_COOKIE = "__Host-circuitgate-session";

	@Autowired
	MockMvc mvc;

	@Autowired
	ObjectMapper objectMapper;

	@Autowired
	JdbcTemplate jdbc;

	@Autowired
	UserRepository users;

	@Autowired
	PasswordEncoder passwordEncoder;

	record Csrf(String token, String headerName, Cookie session) {
	}

	record Client(Cookie session, Csrf csrf) {
	}

	Client client(String email) throws Exception {
		User user = new User(UUID.randomUUID(), email, passwordEncoder.encode(PASSWORD), Instant.now());
		user.setEmailVerified(true);
		users.saveAndFlush(user);
		Cookie session = login(email);
		return new Client(session, fetchCsrf(session));
	}

	Cookie login(String email) throws Exception {
		Csrf csrf = fetchCsrf(null);
		MvcResult result = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(
					Map.of("email", email, "password", PASSWORD, "rememberMe", false)))
			.cookie(csrf.session())
			.header(csrf.headerName(), csrf.token()))
			.andReturn();
		assertEquals(204, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		Cookie session = result.getResponse().getCookie(SESSION_COOKIE);
		assertNotNull(session, "login must issue a session cookie");
		return session;
	}

	Csrf fetchCsrf(Cookie session) throws Exception {
		var request = get("/api/auth/csrf");
		if (session != null) {
			request.cookie(session);
		}
		MvcResult result = mvc.perform(request).andReturn();
		assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		Cookie resolved = result.getResponse().getCookie(SESSION_COOKIE);
		if (resolved == null) {
			resolved = session;
		}
		assertNotNull(resolved, "csrf endpoint must establish a session");
		return new Csrf(body.get("token").asText(), body.get("headerName").asText(), resolved);
	}

	ResultActions postJson(String path, Object body, Client client) throws Exception {
		return postJson(path, body, client.session(), client.csrf());
	}

	ResultActions postJson(String path, Object body, Cookie session, Csrf csrf) throws Exception {
		return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(body))
			.cookie(session)
			.header(csrf.headerName(), csrf.token()));
	}

	ResultActions putJson(String path, Object body, Client client) throws Exception {
		return mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(body))
			.cookie(client.session())
			.header(client.csrf().headerName(), client.csrf().token()));
	}

	ResultActions deleteProject(String path, Client client) throws Exception {
		return mvc.perform(delete(path).cookie(client.session())
			.header(client.csrf().headerName(), client.csrf().token()));
	}

	ResultActions getJson(String path, Cookie session) throws Exception {
		var request = get(path);
		if (session != null) {
			request.cookie(session);
		}
		return mvc.perform(request);
	}

	JsonNode body(MvcResult result) throws Exception {
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	JsonNode document(String label) throws Exception {
		return objectMapper.readTree(
				"{\"semantics\":{\"components\":[],\"nets\":[]},\"layout\":{},\"meta\":{\"label\":\"" + label + "\"}}");
	}

	Map<String, Object> createBody(String name, JsonNode document) {
		return Map.of("name", name, "schemaVersion", 1, "document", document);
	}

	Map<String, Object> saveBody(String name, JsonNode document, long version) {
		return Map.of("name", name, "schemaVersion", 1, "version", version, "document", document);
	}

	Map<String, Object> envelope(String name, JsonNode document) {
		return Map.of("format", "circuitgate-project", "schemaVersion", 1, "contentVersion", 1, "name", name,
				"document", document);
	}

	UUID userId(String email) {
		return jdbc.queryForObject("select id from users where email = ?", UUID.class, email);
	}

	long projectCount(String email) {
		Long count = jdbc.queryForObject("select count(*) from projects where owner_id = ?", Long.class,
				userId(email));
		return count == null ? 0 : count;
	}

	UUID createProject(Client client, String name, JsonNode document) throws Exception {
		MvcResult result = postJson("/api/projects", createBody(name, document), client).andReturn();
		assertEquals(201, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return UUID.fromString(body(result).get("id").asText());
	}
}
