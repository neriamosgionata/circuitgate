package dev.circuitgate.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import dev.circuitgate.TestcontainersConfiguration;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class PasswordResetFlowTest extends AccountApiTestSupport {

	@Test
	void resetRevokesSessionsAndOldPasswordAndTokenIsSingleUse() throws Exception {
		String email = "reset-flow@example.com";
		createVerifiedUser(email, PASSWORD);
		Cookie firstSession = loginSession(email, PASSWORD);
		MvcResult rememberMeLogin = login(email, PASSWORD, true);
		assertEquals(204, rememberMeLogin.getResponse().getStatus());

		requestReset(email);
		String token = mail.latest(CapturedMail.Type.PASSWORD_RESET, email).orElseThrow().token();

		MvcResult reset = resetPassword(token, NEW_PASSWORD);
		assertEquals(204, reset.getResponse().getStatus(), reset.getResponse().getContentAsString());

		assertEquals(401, getMe(firstSession).getResponse().getStatus(), "reset must revoke existing sessions");
		assertEquals(401, login(email, PASSWORD, false).getResponse().getStatus(), "old password must stop working");
		assertEquals(204, login(email, NEW_PASSWORD, false).getResponse().getStatus());

		Integer rememberMeRecords = jdbc.queryForObject("select count(*) from persistent_logins where username = ?",
				Integer.class, email);
		assertEquals(0, rememberMeRecords, "reset must revoke remember-me records");

		MvcResult replay = resetPassword(token, PASSWORD);
		assertEquals(400, replay.getResponse().getStatus(), "reset tokens must be single-use");
	}

	@Test
	void expiredResetTokenIsRejected() throws Exception {
		String email = "reset-expired@example.com";
		createVerifiedUser(email, PASSWORD);
		requestReset(email);
		String token = mail.latest(CapturedMail.Type.PASSWORD_RESET, email).orElseThrow().token();

		jdbc.update("""
				update auth_tokens set expires_at = now() - interval '1 second'
				where type = 'PASSWORD_RESET'
				  and consumed_at is null
				  and user_id = (select id from users where email = ?)
				""", email);

		MvcResult expired = resetPassword(token, NEW_PASSWORD);
		assertEquals(400, expired.getResponse().getStatus(), expired.getResponse().getContentAsString());
		assertEquals("invalid_token", json(expired).get("error").asText());
	}

	@Test
	void parallelRedemptionOfOneResetTokenYieldsExactlyOneSuccess() throws Exception {
		String email = "reset-parallel@example.com";
		createVerifiedUser(email, PASSWORD);
		requestReset(email);
		String token = mail.latest(CapturedMail.Type.PASSWORD_RESET, email).orElseThrow().token();

		ExecutorService pool = Executors.newFixedThreadPool(2);
		CountDownLatch start = new CountDownLatch(1);
		Callable<Integer> redemption = () -> {
			start.await(5, TimeUnit.SECONDS);
			Csrf csrf = fetchCsrf();
			return postJson("/api/auth/password/reset", Map.of("token", token, "newPassword", NEW_PASSWORD), csrf)
				.andReturn()
				.getResponse()
				.getStatus();
		};
		try {
			Future<Integer> first = pool.submit(redemption);
			Future<Integer> second = pool.submit(redemption);
			start.countDown();
			List<Integer> statuses = List.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS));
			assertEquals(1, statuses.stream().filter(status -> status == 204).count(), statuses.toString());
			assertEquals(1, statuses.stream().filter(status -> status == 400).count(), statuses.toString());
		}
		finally {
			pool.shutdownNow();
		}
	}

	@Test
	void knownAndUnknownEmailsProduceIndistinguishableResetResponses() throws Exception {
		String known = "reset-known@example.com";
		createVerifiedUser(known, PASSWORD);
		String unknown = "reset-unknown@example.com";

		long knownStart = System.nanoTime();
		MvcResult knownResult = postJson("/api/auth/password/reset-request", Map.of("email", known), fetchCsrf()).andReturn();
		long knownMillis = Duration.ofNanos(System.nanoTime() - knownStart).toMillis();

		long unknownStart = System.nanoTime();
		MvcResult unknownResult = postJson("/api/auth/password/reset-request", Map.of("email", unknown), fetchCsrf()).andReturn();
		long unknownMillis = Duration.ofNanos(System.nanoTime() - unknownStart).toMillis();

		assertEquals(202, knownResult.getResponse().getStatus());
		assertEquals(202, unknownResult.getResponse().getStatus());
		assertEquals(knownResult.getResponse().getContentAsString(), unknownResult.getResponse().getContentAsString());
		assertTrue(Math.abs(knownMillis - unknownMillis) < 500,
				"reset request timing differs: known=" + knownMillis + "ms unknown=" + unknownMillis + "ms");

		assertTrue(mail.latest(CapturedMail.Type.PASSWORD_RESET, known).isPresent());
		assertFalse(mail.latest(CapturedMail.Type.PASSWORD_RESET, unknown).isPresent());
	}

	private void requestReset(String email) throws Exception {
		MvcResult result = postJson("/api/auth/password/reset-request", Map.of("email", email), fetchCsrf()).andReturn();
		assertEquals(202, result.getResponse().getStatus(), result.getResponse().getContentAsString());
	}

	private MvcResult resetPassword(String token, String newPassword) throws Exception {
		return postJson("/api/auth/password/reset", Map.of("token", token, "newPassword", newPassword), fetchCsrf())
			.andReturn();
	}
}
