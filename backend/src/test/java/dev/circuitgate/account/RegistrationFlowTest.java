package dev.circuitgate.account;

import static dev.circuitgate.account.CapturedMail.Type.DUPLICATE_REGISTRATION_NOTICE;
import static dev.circuitgate.account.CapturedMail.Type.VERIFICATION;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.Map;

import dev.circuitgate.TestcontainersConfiguration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RegistrationFlowTest extends AccountApiTestSupport {

	@Test
	void registrationCreatesUnverifiedAccountAndLoginIsDenied() throws Exception {
		String email = "reg-unverified@example.com";
		register(email, PASSWORD);

		Boolean verified = jdbc.queryForObject("select email_verified from users where email = ?", Boolean.class, email);
		assertFalse(verified, "registration must leave the account unverified");

		MvcResult login = login(email, PASSWORD, false);
		assertEquals(403, login.getResponse().getStatus(), login.getResponse().getContentAsString());
		assertEquals("email_not_verified", json(login).get("error").asText());
		assertNull(sessionCookie(login), "unverified login must not establish a session");
	}

	@Test
	void verificationAllowsLoginAndTokenIsSingleUse() throws Exception {
		String email = "reg-verify@example.com";
		String token = register(email, PASSWORD);
		verify(email, token);

		MvcResult replay = postJson("/api/auth/verify-email", Map.of("token", token), fetchCsrf()).andReturn();
		assertEquals(400, replay.getResponse().getStatus(), replay.getResponse().getContentAsString());

		MvcResult login = login(email, PASSWORD, false);
		assertEquals(204, login.getResponse().getStatus(), login.getResponse().getContentAsString());
		MvcResult me = getMe(sessionCookie(login));
		assertEquals(200, me.getResponse().getStatus(), me.getResponse().getContentAsString());
		assertEquals(email, json(me).get("email").asText());
	}

	@Test
	void duplicateRegistrationSendsNoticeWithoutRevealingExistence() throws Exception {
		String email = "reg-duplicate@example.com";
		MvcResult first = registerRaw(email, PASSWORD);
		MvcResult second = registerRaw(email, PASSWORD);

		assertEquals(202, second.getResponse().getStatus(), second.getResponse().getContentAsString());
		assertEquals(first.getResponse().getContentAsString(), second.getResponse().getContentAsString());

		List<CapturedMail> messages = mail.messagesTo(email);
		assertEquals(1, messages.stream().filter(message -> message.type() == VERIFICATION).count());
		assertEquals(1, messages.stream().filter(message -> message.type() == DUPLICATE_REGISTRATION_NOTICE).count());

		MvcResult unknown = registerRaw("reg-unknown@example.com", PASSWORD);
		assertEquals(unknown.getResponse().getContentAsString(), second.getResponse().getContentAsString());
	}

	@Test
	void verificationResendInvalidatesPreviousTokenAndIsRateLimited() throws Exception {
		String email = "reg-resend@example.com";
		String firstToken = register(email, PASSWORD);

		resend(email);
		String secondToken = mail.latest(VERIFICATION, email).orElseThrow().token();
		assertNotEquals(firstToken, secondToken);

		MvcResult stale = postJson("/api/auth/verify-email", Map.of("token", firstToken), fetchCsrf()).andReturn();
		assertEquals(400, stale.getResponse().getStatus(), "resend must invalidate the previous token");
		verify(email, secondToken);

		resend(email);
		resend(email);

		MvcResult limited = postJson("/api/auth/verify-email/resend", Map.of("email", email), fetchCsrf()).andReturn();
		assertEquals(429, limited.getResponse().getStatus(), limited.getResponse().getContentAsString());
		assertEquals("rate_limited", json(limited).get("error").asText());
	}

	private void verify(String email, String token) throws Exception {
		MvcResult result = postJson("/api/auth/verify-email", Map.of("token", token), fetchCsrf()).andReturn();
		assertEquals(204, result.getResponse().getStatus(), result.getResponse().getContentAsString());
	}

	private void resend(String email) throws Exception {
		MvcResult result = postJson("/api/auth/verify-email/resend", Map.of("email", email), fetchCsrf()).andReturn();
		assertEquals(202, result.getResponse().getStatus(), result.getResponse().getContentAsString());
	}
}
