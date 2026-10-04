package dev.circuitgate.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;

import dev.circuitgate.TestcontainersConfiguration;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SessionSecurityTest extends AccountApiTestSupport {

	@Test
	void sessionCookieUsesHostPrefixAndRotatesOnLogin() throws Exception {
		String email = "session-flags@example.com";
		createVerifiedUser(email, PASSWORD);

		Csrf preLogin = fetchCsrf();
		assertNotNull(preLogin.session(), "the csrf token must be bound to a session");

		MvcResult login = login(email, PASSWORD, false);
		assertEquals(204, login.getResponse().getStatus(), login.getResponse().getContentAsString());
		Cookie postLogin = sessionCookie(login);
		assertNotNull(postLogin);
		assertNotEquals(preLogin.session().getValue(), postLogin.getValue(), "session id must rotate on login");

		String header = setCookieHeader(login, SESSION_COOKIE);
		assertNotNull(header, "login must set the session cookie");
		assertTrue(header.contains("Path=/"), header);
		assertTrue(header.contains("HttpOnly"), header);
		assertTrue(header.contains("Secure"), header);
		assertTrue(header.toLowerCase().contains("samesite=lax"), header);

		assertEquals(401, getMe(preLogin.session()).getResponse().getStatus(),
				"the pre-authentication session must be useless after login");
		assertEquals(200, getMe(postLogin).getResponse().getStatus());
	}

	@Test
	void stateChangingRequestsWithoutCsrfTokenAreRejected() throws Exception {
		int registerStatus = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
			.content("{\"email\":\"no-csrf@example.com\",\"password\":\"correct-horse-9\"}"))
			.andReturn()
			.getResponse()
			.getStatus();
		assertEquals(403, registerStatus);

		int loginStatus = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.content("{\"email\":\"no-csrf@example.com\",\"password\":\"correct-horse-9\"}"))
			.andReturn()
			.getResponse()
			.getStatus();
		assertEquals(403, loginStatus);
	}

	@Test
	void logoutInvalidatesCurrentSession() throws Exception {
		String email = "session-logout@example.com";
		createVerifiedUser(email, PASSWORD);
		Cookie session = loginSession(email, PASSWORD);

		Csrf csrf = fetchCsrf(session);
		MvcResult logout = postJson("/api/auth/logout", Map.of(), csrf).andReturn();
		assertEquals(204, logout.getResponse().getStatus(), logout.getResponse().getContentAsString());
		assertEquals(401, getMe(session).getResponse().getStatus(), "logout must invalidate the session");
	}

	@Test
	void logoutAllInvalidatesEverySessionAndRememberMeRecord() throws Exception {
		String email = "session-logout-all@example.com";
		createVerifiedUser(email, PASSWORD);

		MvcResult first = login(email, PASSWORD, true);
		Cookie firstSession = sessionCookie(first);
		assertNotNull(rememberMeCookie(first));
		Cookie secondSession = loginSession(email, PASSWORD);

		Integer records = jdbc.queryForObject("select count(*) from persistent_logins where username = ?",
				Integer.class, email);
		assertEquals(1, records);

		Csrf csrf = fetchCsrf(firstSession);
		MvcResult logoutAll = postJson("/api/auth/logout-all", Map.of(), csrf).andReturn();
		assertEquals(204, logoutAll.getResponse().getStatus(), logoutAll.getResponse().getContentAsString());

		assertEquals(401, getMe(firstSession).getResponse().getStatus());
		assertEquals(401, getMe(secondSession).getResponse().getStatus());
		Integer remaining = jdbc.queryForObject("select count(*) from persistent_logins where username = ?",
				Integer.class, email);
		assertEquals(0, remaining);
	}

	@Test
	void replayedRotatedRememberMeTokenRevokesSeries() throws Exception {
		String email = "session-remember@example.com";
		createVerifiedUser(email, PASSWORD);

		MvcResult login = login(email, PASSWORD, true);
		Cookie original = rememberMeCookie(login);
		assertNotNull(original, "remember-me login must set a cookie");

		MvcResult autoLogin = mvc.perform(get("/api/auth/me").cookie(original)).andReturn();
		assertEquals(200, autoLogin.getResponse().getStatus(), autoLogin.getResponse().getContentAsString());
		Cookie rotated = rememberMeCookie(autoLogin);
		assertNotNull(rotated, "remember-me token must rotate on use");
		assertNotEquals(original.getValue(), rotated.getValue());

		MvcResult replayOld = mvc.perform(get("/api/auth/me").cookie(original)).andReturn();
		assertEquals(401, replayOld.getResponse().getStatus(), "a replayed old token must be rejected");

		MvcResult replayCurrent = mvc.perform(get("/api/auth/me").cookie(rotated)).andReturn();
		assertEquals(401, replayCurrent.getResponse().getStatus(), "replay must revoke the whole series");
	}

	@Test
	void passwordChangeRevokesOtherSessionsButKeepsCurrent() throws Exception {
		String email = "session-change-password@example.com";
		createVerifiedUser(email, PASSWORD);
		Cookie current = loginSession(email, PASSWORD);
		Cookie other = loginSession(email, PASSWORD);

		Csrf csrf = fetchCsrf(current);
		MvcResult change = postJson("/api/auth/password/change",
				Map.of("currentPassword", PASSWORD, "newPassword", NEW_PASSWORD), csrf)
			.andReturn();
		assertEquals(204, change.getResponse().getStatus(), change.getResponse().getContentAsString());

		assertEquals(200, getMe(current).getResponse().getStatus(), "the current session must survive");
		assertEquals(401, getMe(other).getResponse().getStatus(), "other sessions must be revoked");
		assertEquals(401, login(email, PASSWORD, false).getResponse().getStatus());
		assertEquals(204, login(email, NEW_PASSWORD, false).getResponse().getStatus());
	}

	@Test
	void wrongCurrentPasswordIsRejected() throws Exception {
		String email = "session-change-wrong@example.com";
		createVerifiedUser(email, PASSWORD);
		Cookie session = loginSession(email, PASSWORD);

		Csrf csrf = fetchCsrf(session);
		MvcResult change = postJson("/api/auth/password/change",
				Map.of("currentPassword", "not-the-password", "newPassword", NEW_PASSWORD), csrf)
			.andReturn();
		assertEquals(400, change.getResponse().getStatus(), change.getResponse().getContentAsString());
		assertEquals("invalid_password", json(change).get("error").asText());
		assertEquals(204, login(email, PASSWORD, false).getResponse().getStatus());
	}
}
