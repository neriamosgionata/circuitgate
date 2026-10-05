package dev.circuitgate.support;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.Instant;
import java.util.HashMap;
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

public abstract class ProjectFeatureTestSupport {

	protected static final String PASSWORD = "correct-horse-9";

	protected static final String SESSION_COOKIE = "__Host-circuitgate-session";

	@Autowired
	protected MockMvc mvc;

	@Autowired
	protected ObjectMapper objectMapper;

	@Autowired
	protected JdbcTemplate jdbc;

	@Autowired
	protected UserRepository users;

	@Autowired
	protected PasswordEncoder passwordEncoder;

	public record Csrf(String token, String headerName, Cookie session) {
	}

	public record Client(Cookie session, Csrf csrf) {
	}

	protected UUID createUser(String email, boolean verified) {
		User user = new User(UUID.randomUUID(), email, passwordEncoder.encode(PASSWORD), Instant.now());
		user.setEmailVerified(verified);
		users.saveAndFlush(user);
		return user.getId();
	}

	protected Client client(String email) throws Exception {
		createUser(email, true);
		Cookie session = login(email);
		return new Client(session, fetchCsrf(session));
	}

	protected Cookie login(String email) throws Exception {
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

	protected Csrf fetchCsrf(Cookie session) throws Exception {
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

	protected ResultActions postJson(String path, Object body, Client client) throws Exception {
		return postJson(path, body, client.session(), client.csrf());
	}

	protected ResultActions postJson(String path, Object body, Cookie session, Csrf csrf) throws Exception {
		return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(body))
			.cookie(session)
			.header(csrf.headerName(), csrf.token()));
	}

	protected ResultActions putJson(String path, Object body, Client client) throws Exception {
		return mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(body))
			.cookie(client.session())
			.header(client.csrf().headerName(), client.csrf().token()));
	}

	protected ResultActions deleteJson(String path, Client client) throws Exception {
		return mvc.perform(delete(path).cookie(client.session())
			.header(client.csrf().headerName(), client.csrf().token()));
	}

	protected ResultActions getJson(String path, Cookie session) throws Exception {
		var request = get(path);
		if (session != null) {
			request.cookie(session);
		}
		return mvc.perform(request);
	}

	protected JsonNode body(MvcResult result) throws Exception {
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	protected JsonNode document(String label) throws Exception {
		return objectMapper.readTree(
				"{\"semantics\":{\"components\":[],\"nets\":[]},\"layout\":{},\"meta\":{\"label\":\"" + label + "\"}}");
	}

	protected Map<String, Object> createBody(String name, JsonNode document) {
		return Map.of("name", name, "schemaVersion", 1, "document", document);
	}

	protected Map<String, Object> saveBody(String name, JsonNode document, long version) {
		return saveBody(name, document, version, null);
	}

	protected Map<String, Object> saveBody(String name, JsonNode document, long version, Long lockEpoch) {
		Map<String, Object> payload = new HashMap<>();
		payload.put("name", name);
		payload.put("schemaVersion", 1);
		payload.put("version", version);
		payload.put("document", document);
		if (lockEpoch != null) {
			payload.put("lockEpoch", lockEpoch);
		}
		return payload;
	}

	protected UUID userId(String email) {
		return jdbc.queryForObject("select id from users where email = ?", UUID.class, email);
	}

	protected UUID createProject(Client client, String name) throws Exception {
		MvcResult result = postJson("/api/projects", createBody(name, document(name)), client).andReturn();
		assertEquals(201, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return UUID.fromString(body(result).get("id").asText());
	}

	protected UUID createTeam(Client client, String name) throws Exception {
		MvcResult result = postJson("/api/teams", Map.of("name", name), client).andReturn();
		assertEquals(201, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return UUID.fromString(body(result).get("id").asText());
	}

	protected void addMember(Client client, UUID teamId, String email) throws Exception {
		MvcResult result = postJson("/api/teams/" + teamId + "/members", Map.of("email", email), client).andReturn();
		assertEquals(201, result.getResponse().getStatus(), result.getResponse().getContentAsString());
	}

	protected MvcResult share(Client client, UUID projectId, UUID teamId) throws Exception {
		return postJson("/api/projects/" + projectId + "/shares", Map.of("teamId", teamId.toString()), client)
			.andReturn();
	}

	protected MvcResult acquire(Client client, UUID projectId) throws Exception {
		return postJson("/api/projects/" + projectId + "/lock", Map.of(), client).andReturn();
	}

	protected MvcResult heartbeat(Client client, UUID projectId, long epoch) throws Exception {
		return postJson("/api/projects/" + projectId + "/lock/heartbeat", Map.of("epoch", epoch), client)
			.andReturn();
	}

	protected MvcResult releaseLock(Client client, UUID projectId, long epoch) throws Exception {
		return mvc
			.perform(delete("/api/projects/" + projectId + "/lock").contentType(MediaType.APPLICATION_JSON)
				.content(objectMapper.writeValueAsString(Map.of("epoch", epoch)))
				.cookie(client.session())
				.header(client.csrf().headerName(), client.csrf().token()))
			.andReturn();
	}

	protected long acquireEpoch(Client client, UUID projectId) throws Exception {
		MvcResult result = acquire(client, projectId);
		assertEquals(201, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return body(result).get("epoch").asLong();
	}

	protected long lockEpoch(UUID projectId) {
		Long epoch = jdbc.queryForObject("select epoch from project_locks where project_id = ?", Long.class,
				projectId);
		return epoch == null ? 0 : epoch;
	}

	protected boolean lockActive(UUID projectId) {
		Boolean active = jdbc.queryForObject(
				"select (released_at is null and expires_at > now()) from project_locks where project_id = ?",
				Boolean.class, projectId);
		return Boolean.TRUE.equals(active);
	}

	protected boolean lockActiveFor(UUID projectId, UUID holderId) {
		Boolean active = jdbc.queryForObject("""
				select (released_at is null and expires_at > now() and holder_id = ?)
				  from project_locks
				 where project_id = ?
				""", Boolean.class, holderId, projectId);
		return Boolean.TRUE.equals(active);
	}

	protected UUID lockHolder(UUID projectId) {
		return jdbc.queryForObject("select holder_id from project_locks where project_id = ?", UUID.class, projectId);
	}

	protected void expireLock(UUID projectId) {
		jdbc.update("""
				update project_locks
				   set expires_at = now() - interval '1 second'
				 where project_id = ?
				""", projectId);
	}
}
