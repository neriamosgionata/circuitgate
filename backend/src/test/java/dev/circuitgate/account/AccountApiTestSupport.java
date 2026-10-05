package dev.circuitgate.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import jakarta.servlet.http.Cookie;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

class AccountApiTestSupport {

	static final String PASSWORD = "correct-horse-9";
	static final String NEW_PASSWORD = "correct-horse-10";
	static final String SESSION_COOKIE = "__Host-circuitgate-session";
	static final String REMEMBER_ME_COOKIE = "circuitgate-remember-me";

	@Autowired
	MockMvc mvc;

	@Autowired
	ObjectMapper objectMapper;

	@Autowired
	CapturingMailService mail;

	@Autowired
	JdbcTemplate jdbc;

	record Csrf(String token, String headerName, Cookie session) {
	}

	Csrf fetchCsrf() throws Exception {
		MvcResult result = mvc.perform(get("/api/auth/csrf")).andReturn();
		assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return csrfFrom(result, null);
	}

	Csrf fetchCsrf(Cookie session) throws Exception {
		MvcResult result = mvc.perform(get("/api/auth/csrf").cookie(session)).andReturn();
		assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return csrfFrom(result, session);
	}

	private Csrf csrfFrom(MvcResult result, Cookie fallback) throws Exception {
		JsonNode body = json(result);
		Cookie session = sessionCookie(result) != null ? sessionCookie(result) : fallback;
		return new Csrf(body.get("token").asText(), body.get("headerName").asText(), session);
	}

	JsonNode json(MvcResult result) throws Exception {
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	Cookie sessionCookie(MvcResult result) {
		return result.getResponse().getCookie(SESSION_COOKIE);
	}

	Cookie rememberMeCookie(MvcResult result) {
		return result.getResponse().getCookie(REMEMBER_ME_COOKIE);
	}

	String setCookieHeader(MvcResult result, String name) {
		for (String header : result.getResponse().getHeaders("Set-Cookie")) {
			if (header.startsWith(name + "=")) {
				return header;
			}
		}
		return null;
	}

	ResultActions postJson(String path, Object body, Csrf csrf) throws Exception {
		return postJson(path, body, csrf.session(), csrf.headerName(), csrf.token());
	}

	ResultActions postJson(String path, Object body, Cookie session, String headerName, String token) throws Exception {
		var builder = post(path).contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body));
		if (session != null) {
			builder.cookie(session);
		}
		if (token != null) {
			builder.header(headerName, token);
		}
		return mvc.perform(builder);
	}

	MvcResult registerRaw(String email, String password) throws Exception {
		Csrf csrf = fetchCsrf();
		return postJson("/api/auth/register", Map.of("email", email, "password", password), csrf).andReturn();
	}

	String register(String email, String password) throws Exception {
		MvcResult result = registerRaw(email, password);
		assertEquals(202, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		return mail.latest(CapturedMail.Type.VERIFICATION, email).orElseThrow().token();
	}

	void createVerifiedUser(String email, String password) throws Exception {
		String token = register(email, password);
		Csrf csrf = fetchCsrf();
		postJson("/api/auth/verify-email", Map.of("token", token), csrf).andExpect(result -> assertEquals(204, result.getResponse().getStatus()));
	}

	MvcResult login(String email, String password, boolean rememberMe) throws Exception {
		Csrf csrf = fetchCsrf();
		return postJson("/api/auth/login", Map.of("email", email, "password", password, "rememberMe", rememberMe), csrf)
			.andReturn();
	}

	Cookie loginSession(String email, String password) throws Exception {
		MvcResult result = login(email, password, false);
		assertEquals(204, result.getResponse().getStatus(), result.getResponse().getContentAsString());
		Cookie cookie = sessionCookie(result);
		assertNotNull(cookie, "login must issue a session cookie");
		return cookie;
	}

	MvcResult getMe(Cookie session) throws Exception {
		return mvc.perform(get("/api/auth/me").cookie(session)).andReturn();
	}
}
