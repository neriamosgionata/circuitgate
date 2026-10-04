package dev.circuitgate.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

import dev.circuitgate.TestcontainersConfiguration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import({ TestcontainersConfiguration.class, MailFailureTest.FailingMailConfig.class })
class MailFailureTest extends AccountApiTestSupport {

	@Autowired
	FailingMailService failingMail;

	@Test
	void mailDeliveryFailureIsRetryableAndAccountStateSurvives() throws Exception {
		String email = "mail-failure@example.com";

		MvcResult failed = registerRaw(email, PASSWORD);
		assertEquals(503, failed.getResponse().getStatus(), failed.getResponse().getContentAsString());
		assertEquals("mail_unavailable", json(failed).get("error").asText());

		Integer accounts = jdbc.queryForObject("select count(*) from users where email = ?", Integer.class, email);
		assertEquals(1, accounts, "the account must survive a mail delivery failure");
		Boolean verified = jdbc.queryForObject("select email_verified from users where email = ?", Boolean.class, email);
		assertFalse(verified);

		failingMail.failing.set(false);

		MvcResult resent = postJson("/api/auth/verify-email/resend", Map.of("email", email), fetchCsrf()).andReturn();
		assertEquals(202, resent.getResponse().getStatus(), resent.getResponse().getContentAsString());
		String token = failingMail.latest(CapturedMail.Type.VERIFICATION, email).orElseThrow().token();

		MvcResult verifiedResult = postJson("/api/auth/verify-email", Map.of("token", token), fetchCsrf()).andReturn();
		assertEquals(204, verifiedResult.getResponse().getStatus(), verifiedResult.getResponse().getContentAsString());
		assertEquals(204, login(email, PASSWORD, false).getResponse().getStatus());
	}

	@TestConfiguration(proxyBeanMethods = false)
	static class FailingMailConfig {

		@Bean
		@Primary
		FailingMailService failingMailService() {
			return new FailingMailService();
		}
	}

	static class FailingMailService implements MailService {

		final AtomicBoolean failing = new AtomicBoolean(true);

		private final List<CapturedMail> captured = new CopyOnWriteArrayList<>();

		@Override
		public void sendVerificationEmail(String to, String token) {
			maybeFail();
			captured.add(new CapturedMail(CapturedMail.Type.VERIFICATION, to, token, "verification", "verification"));
		}

		@Override
		public void sendPasswordResetEmail(String to, String token) {
			maybeFail();
			captured.add(new CapturedMail(CapturedMail.Type.PASSWORD_RESET, to, token, "reset", "reset"));
		}

		@Override
		public void sendDuplicateRegistrationNotice(String to) {
			maybeFail();
			captured.add(new CapturedMail(CapturedMail.Type.DUPLICATE_REGISTRATION_NOTICE, to, null, "notice", "notice"));
		}

		Optional<CapturedMail> latest(CapturedMail.Type type, String to) {
			return captured.stream()
				.filter(message -> message.type() == type && message.to().equalsIgnoreCase(to))
				.reduce((first, second) -> second);
		}

		private void maybeFail() {
			if (failing.get()) {
				throw new SendMailException("mail delivery failed");
			}
		}
	}
}
