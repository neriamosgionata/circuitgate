package dev.circuitgate.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.util.Map;

import javax.sql.DataSource;

import dev.circuitgate.TestcontainersConfiguration;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.session.Session;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SessionPersistenceTest extends AccountApiTestSupport {

	@Autowired
	JdbcIndexedSessionRepository sessions;

	@Autowired
	DataSource dataSource;

	@Autowired
	PlatformTransactionManager transactionManager;

	@Test
	void sessionIsStoredInDatabaseAndReloadsFromDatabase() throws Exception {
		String email = "session-persistence@example.com";
		createVerifiedUser(email, PASSWORD);
		Cookie sessionCookie = loginSession(email, PASSWORD);

		Integer rows = jdbc.queryForObject("select count(*) from spring_session where principal_name = ?",
				Integer.class, email);
		assertEquals(1, rows, "the authenticated session must be stored in postgresql");

		JdbcIndexedSessionRepository freshRepository = new JdbcIndexedSessionRepository(new JdbcTemplate(dataSource),
				new TransactionTemplate(transactionManager));

		Map<String, ? extends Session> byPrincipal = freshRepository.findByPrincipalName(email);
		assertEquals(1, byPrincipal.size(), "the fresh repository must resolve sessions by principal name");
		Session stored = byPrincipal.values().iterator().next();
		assertNotNull(stored.getAttribute("SPRING_SECURITY_CONTEXT"), "the security context must be persisted");

		Session reloaded = freshRepository.findById(stored.getId());
		assertNotNull(reloaded, "a fresh repository instance must load the session from the database");
		assertNotNull(reloaded.getAttribute("SPRING_SECURITY_CONTEXT"),
				"reloading from the database must restore the security context");

		MvcResult me = getMe(sessionCookie);
		assertEquals(200, me.getResponse().getStatus(), "the session cookie must keep authenticating");
	}
}
