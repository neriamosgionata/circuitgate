package dev.circuitgate.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;

import dev.circuitgate.TestcontainersConfiguration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(properties = { "circuitgate.network.trusted-proxies=10.0.0.0/8",
		"circuitgate.throttle.login.threshold=3", "circuitgate.throttle.login.base-delay=200ms",
		"circuitgate.throttle.login.max-delay=400ms" })
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ThrottlingTest extends AccountApiTestSupport {

	@Test
	void spoofedForwardedAddressFromUntrustedSourceIsIgnored() throws Exception {
		String email = "throttle-spoof@example.com";
		createVerifiedUser(email, PASSWORD);

		MvcResult wrong = null;
		for (int attempt = 0; attempt < 3; attempt++) {
			wrong = loginFrom(email, "wrong-password", "127.0.0.1", "203.0.113.7");
			assertEquals(401, wrong.getResponse().getStatus());
		}

		Integer sourceFailures = jdbc.queryForObject("""
				select failures from throttle_counters
				where scope = 'SOURCE' and action = 'LOGIN' and subject = '127.0.0.1'
				""", Integer.class);
		assertNotNull(sourceFailures);
		assertTrue(sourceFailures >= 3, "failures must be counted against the real remote address");

		Integer spoofedRows = jdbc.queryForObject(
				"select count(*) from throttle_counters where subject = '203.0.113.7'", Integer.class);
		assertEquals(0, spoofedRows, "a spoofed forwarded address must not create a throttle counter");

		MvcResult blocked = loginFrom(email, PASSWORD, "127.0.0.1", "203.0.113.7");
		assertEquals(401, blocked.getResponse().getStatus(), "throttled attempts must be denied");
		assertEquals(wrong.getResponse().getContentAsString(), blocked.getResponse().getContentAsString(),
				"throttled attempts must be indistinguishable from bad credentials");
	}

	@Test
	void trustedProxyDerivedAddressScopesCounters() throws Exception {
		String throttled = "throttle-derived-a@example.com";
		createVerifiedUser(throttled, PASSWORD);
		for (int attempt = 0; attempt < 3; attempt++) {
			assertEquals(401, loginFrom(throttled, "wrong-password", "10.0.0.5", "198.51.100.7").getResponse().getStatus());
		}

		Integer forwardedFailures = jdbc.queryForObject("""
				select failures from throttle_counters
				where scope = 'SOURCE' and action = 'LOGIN' and subject = '198.51.100.7'
				""", Integer.class);
		assertNotNull(forwardedFailures, "trusted proxied requests must be counted by forwarded address");
		assertTrue(forwardedFailures >= 3);

		Integer proxyRows = jdbc.queryForObject(
				"select count(*) from throttle_counters where subject = '10.0.0.5'", Integer.class);
		assertEquals(0, proxyRows, "the proxy address itself must not become a throttle subject");

		String other = "throttle-derived-b@example.com";
		createVerifiedUser(other, PASSWORD);
		assertEquals(401, loginFrom(other, PASSWORD, "10.0.0.9", "198.51.100.7").getResponse().getStatus(),
				"a blocked forwarded source must throttle other accounts too");
		assertEquals(204, loginFrom(other, PASSWORD, "10.0.0.9", "192.0.2.55").getResponse().getStatus(),
				"a different forwarded source must be allowed");
	}

	@Test
	void cooldownExpiresAndSuccessfulLoginResetsCounters() throws Exception {
		String email = "throttle-cooldown@example.com";
		createVerifiedUser(email, PASSWORD);

		for (int attempt = 0; attempt < 3; attempt++) {
			assertEquals(401, loginFrom(email, "wrong-password", "127.0.0.2", null).getResponse().getStatus());
		}
		assertEquals(401, loginFrom(email, PASSWORD, "127.0.0.2", null).getResponse().getStatus(),
				"correct credentials during cooldown must be denied");

		Thread.sleep(700);

		assertEquals(204, loginFrom(email, PASSWORD, "127.0.0.2", null).getResponse().getStatus(),
				"cooldown must self-recover");

		Integer accountRows = jdbc.queryForObject("""
				select count(*) from throttle_counters
				where scope = 'ACCOUNT' and action = 'LOGIN' and subject = ?
				""", Integer.class, email);
		Integer sourceRows = jdbc.queryForObject("""
				select count(*) from throttle_counters
				where scope = 'SOURCE' and action = 'LOGIN' and subject = '127.0.0.2'
				""", Integer.class);
		assertEquals(0, accountRows, "successful login must reset account counters");
		assertEquals(0, sourceRows, "successful login must reset source counters");
	}

	private MvcResult loginFrom(String email, String password, String remoteAddress, String forwardedFor)
			throws Exception {
		Csrf csrf = fetchCsrf();
		var builder = post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
			.content(objectMapper.writeValueAsString(Map.of("email", email, "password", password, "rememberMe", false)))
			.cookie(csrf.session())
			.header(csrf.headerName(), csrf.token())
			.with(request -> {
				request.setRemoteAddr(remoteAddress);
				return request;
			});
		if (forwardedFor != null) {
			builder.header("X-Forwarded-For", forwardedFor);
		}
		return mvc.perform(builder).andReturn();
	}
}
