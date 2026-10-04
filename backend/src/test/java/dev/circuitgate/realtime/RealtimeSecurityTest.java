package dev.circuitgate.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Collectors;

import dev.circuitgate.TestcontainersConfiguration;
import dev.circuitgate.account.User;
import dev.circuitgate.account.UserRepository;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
		"server.servlet.session.cookie.name=test-session", "server.servlet.session.cookie.secure=false",
		"circuitgate.realtime.allowed-origins[0]=http://allowed.test" })
@Import(TestcontainersConfiguration.class)
class RealtimeSecurityTest {

	private static final String PASSWORD = "correct-horse-9";

	private static final String ALLOWED_ORIGIN = "http://allowed.test";

	@LocalServerPort
	int port;

	@Autowired
	ObjectMapper objectMapper;

	@Autowired
	UserRepository users;

	@Autowired
	PasswordEncoder passwordEncoder;

	@Autowired
	RealtimeSessionRegistry registry;

	private String base() {
		return "http://localhost:" + port;
	}

	private String websocketUrl() {
		return "ws://localhost:" + port + "/ws";
	}

	private record Csrf(String header, String token) {
	}

	private record UserSession(String email, HttpClient http, CookieManager cookies, String csrfHeader,
			String csrfToken) {
	}

	private static final class SessionHandler extends StompSessionHandlerAdapter {

		private final CountDownLatch connected = new CountDownLatch(1);

		private final CountDownLatch disconnected = new CountDownLatch(1);

		private volatile Throwable error;

		@Override
		public void afterConnected(StompSession session, StompHeaders connectedHeaders) {
			connected.countDown();
		}

		@Override
		public void handleTransportError(StompSession session, Throwable exception) {
			error = exception;
			disconnected.countDown();
		}

		@Override
		public void handleException(StompSession session, StompCommand command, StompHeaders headers, byte[] payload,
				Throwable exception) {
			error = exception;
			disconnected.countDown();
		}

		boolean awaitConnected() throws InterruptedException {
			return connected.await(5, TimeUnit.SECONDS);
		}

		boolean awaitDisconnected() throws InterruptedException {
			return awaitDisconnected(5);
		}

		boolean awaitDisconnected(long seconds) throws InterruptedException {
			return disconnected.await(seconds, TimeUnit.SECONDS);
		}
	}

	private static final class RecordingFrameHandler implements StompFrameHandler {

		private final LinkedBlockingQueue<Object> messages = new LinkedBlockingQueue<>();

		@Override
		public java.lang.reflect.Type getPayloadType(StompHeaders headers) {
			return Map.class;
		}

		@Override
		@SuppressWarnings("unchecked")
		public void handleFrame(StompHeaders headers, Object payload) {
			messages.add(payload);
		}

		Map<String, Object> next() throws InterruptedException {
			Object message = messages.poll(5, TimeUnit.SECONDS);
			if (message == null) {
				fail("expected a realtime event but none arrived");
			}
			return (Map<String, Object>) message;
		}
	}

	private void createVerifiedUser(String email) {
		User user = new User(UUID.randomUUID(), email, passwordEncoder.encode(PASSWORD), Instant.now());
		user.setEmailVerified(true);
		users.saveAndFlush(user);
	}

	private UserSession session(String email) throws Exception {
		createVerifiedUser(email);
		CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
		HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
		Csrf csrf = fetchCsrf(client);
		HttpResponse<String> login = client.send(HttpRequest.newBuilder(URI.create(base() + "/api/auth/login"))
			.header("Content-Type", "application/json")
			.header(csrf.header(), csrf.token())
			.POST(HttpRequest.BodyPublishers
				.ofString(objectMapper.writeValueAsString(
						Map.of("email", email, "password", PASSWORD, "rememberMe", false))))
			.build(), BodyHandlers.ofString());
		assertEquals(204, login.statusCode(), login.body());
		Csrf rotated = fetchCsrf(client);
		return new UserSession(email, client, cookies, rotated.header(), rotated.token());
	}

	private Csrf fetchCsrf(HttpClient client) throws Exception {
		HttpResponse<String> response = client.send(
				HttpRequest.newBuilder(URI.create(base() + "/api/auth/csrf")).GET().build(), BodyHandlers.ofString());
		assertEquals(200, response.statusCode(), response.body());
		JsonNode body = objectMapper.readTree(response.body());
		return new Csrf(body.get("headerName").asText(), body.get("token").asText());
	}

	private HttpResponse<String> post(UserSession session, String path, Object payload) throws Exception {
		return session.http()
			.send(HttpRequest.newBuilder(URI.create(base() + path))
				.header("Content-Type", "application/json")
				.header(session.csrfHeader(), session.csrfToken())
				.POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload)))
				.build(), BodyHandlers.ofString());
	}

	private HttpResponse<String> get(UserSession session, String path) throws Exception {
		return session.http().send(HttpRequest.newBuilder(URI.create(base() + path)).GET().build(),
				BodyHandlers.ofString());
	}

	private UUID createProject(UserSession session, String name) throws Exception {
		HttpResponse<String> response = post(session, "/api/projects",
				Map.of("name", name, "schemaVersion", 1,
						"document", Map.of("semantics", Map.of("components", List.of(), "nets", List.of()), "layout", Map.of(),
								"meta", Map.of("label", name))));
		assertEquals(201, response.statusCode(), response.body());
		return UUID.fromString(objectMapper.readTree(response.body()).get("id").asText());
	}

	private record SharedProject(UserSession owner, UserSession member, UUID projectId) {
	}

	private SharedProject sharedProject(String label) throws Exception {
		UserSession owner = session(label + "-owner@example.test");
		String memberEmail = label + "-member@example.test";
		UserSession member = session(memberEmail);
		UUID projectId = createProject(owner, label + "-project");
		HttpResponse<String> team = post(owner, "/api/teams", Map.of("name", label + "-team"));
		assertEquals(201, team.statusCode(), team.body());
		UUID teamId = UUID.fromString(objectMapper.readTree(team.body()).get("id").asText());
		HttpResponse<String> added = post(owner, "/api/teams/" + teamId + "/members", Map.of("email", memberEmail));
		assertEquals(201, added.statusCode(), added.body());
		HttpResponse<String> shared = post(owner, "/api/projects/" + projectId + "/shares",
				Map.of("teamId", teamId.toString()));
		assertEquals(201, shared.statusCode(), shared.body());
		return new SharedProject(owner, member, projectId);
	}

	private static String cookieHeader(UserSession session) {
		return session.cookies()
			.getCookieStore()
			.getCookies()
			.stream()
			.map(cookie -> cookie.getName() + "=" + cookie.getValue())
			.collect(Collectors.joining("; "));
	}

	private StompSession connect(UserSession session, String origin, SessionHandler handler) throws Exception {
		WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
		client.setMessageConverter(new JacksonJsonMessageConverter());
		WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
		handshake.setOrigin(origin);
		handshake.add(HttpHeaders.COOKIE, cookieHeader(session));
		StompHeaders connectHeaders = new StompHeaders();
		connectHeaders.add(session.csrfHeader(), session.csrfToken());
		return client.connectAsync(websocketUrl(), handshake, connectHeaders, handler).get(5, TimeUnit.SECONDS);
	}

	private void subscribe(StompSession session, UUID projectId, StompFrameHandler handler) throws Exception {
		session.subscribe(RealtimePublisher.projectTopic(projectId), handler);
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (registry.subscriptionCount(projectId, true) == 0 && System.nanoTime() < deadline) {
			Thread.sleep(20);
		}
		assertTrue(registry.subscriptionCount(projectId, true) > 0,
				"the subscription to " + RealtimePublisher.projectTopic(projectId) + " was never registered");
	}

	private void expectHandshakeRejected(UserSession session, String origin) throws Exception {
		WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
		client.setMessageConverter(new JacksonJsonMessageConverter());
		WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
		if (origin != null) {
			handshake.setOrigin(origin);
		}
		handshake.add(HttpHeaders.COOKIE, cookieHeader(session));
		StompHeaders connectHeaders = new StompHeaders();
		connectHeaders.add(session.csrfHeader(), session.csrfToken());
		try {
			client.connectAsync(websocketUrl(), handshake, connectHeaders, new SessionHandler())
				.get(5, TimeUnit.SECONDS);
			fail("expected the WebSocket handshake to be rejected");
		}
		catch (ExecutionException | TimeoutException expected) {
			// rejected as expected
		}
	}

	@Test
	void handshakeWithoutASessionIsRejected() throws Exception {
		WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
		client.setMessageConverter(new JacksonJsonMessageConverter());
		WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
		handshake.setOrigin(ALLOWED_ORIGIN);
		try {
			client.connectAsync(websocketUrl(), handshake, new SessionHandler()).get(5, TimeUnit.SECONDS);
			fail("an unauthenticated handshake must be rejected");
		}
		catch (ExecutionException | TimeoutException expected) {
			// rejected as expected
		}
	}

	@Test
	void handshakeWithAMismatchedOriginIsRejected() throws Exception {
		UserSession session = session("origin-user@example.test");
		expectHandshakeRejected(session, "http://evil.test");
	}

	@Test
	void stompConnectWithoutTheCsrfBindingIsRejected() throws Exception {
		UserSession session = session("no-csrf-user@example.test");
		WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
		client.setMessageConverter(new JacksonJsonMessageConverter());
		WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
		handshake.setOrigin(ALLOWED_ORIGIN);
		handshake.add(HttpHeaders.COOKIE, cookieHeader(session));
		SessionHandler handler = new SessionHandler();
		try {
			client.connectAsync(websocketUrl(), handshake, new StompHeaders(), handler).get(3, TimeUnit.SECONDS);
			assertTrue(handler.awaitDisconnected(), "a CONNECT without the CSRF binding must be closed");
		}
		catch (ExecutionException | TimeoutException expected) {
			// rejected as expected
		}
	}

	@Test
	void subscribingToAForeignProjectTopicIsRejected() throws Exception {
		SharedProject shared = sharedProject("foreign");
		UserSession outsider = session("foreign-outsider@example.test");
		SessionHandler handler = new SessionHandler();
		StompSession stomp = connect(outsider, ALLOWED_ORIGIN, handler);
		assertTrue(handler.awaitConnected());

		stomp.subscribe(RealtimePublisher.projectTopic(shared.projectId()), new RecordingFrameHandler());

		assertTrue(handler.awaitDisconnected(), "a subscription to a foreign project topic must be rejected");
	}

	@Test
	void clientPublishToABroadcastDestinationIsRejected() throws Exception {
		SharedProject shared = sharedProject("publish");
		SessionHandler handler = new SessionHandler();
		StompSession stomp = connect(shared.owner(), ALLOWED_ORIGIN, handler);
		assertTrue(handler.awaitConnected());
		RecordingFrameHandler events = new RecordingFrameHandler();
		subscribe(stomp, shared.projectId(), events);

		stomp.send(RealtimePublisher.projectTopic(shared.projectId()), Map.of("type", "forged"));

		if (!handler.awaitDisconnected(1)) {
			HttpResponse<String> acquired = post(shared.owner(), "/api/projects/" + shared.projectId() + "/lock",
					Map.of());
			assertEquals(201, acquired.statusCode(), acquired.body());
			assertEquals("lock_changed", events.next().get("type"),
					"the forged client publish must never reach the topic");
		}
	}

	@Test
	void lockEventsReachAuthorizedMembers() throws Exception {
		SharedProject shared = sharedProject("events");
		UserSession owner = shared.owner();
		SessionHandler memberHandler = new SessionHandler();
		StompSession member = connect(shared.member(), ALLOWED_ORIGIN, memberHandler);
		assertTrue(memberHandler.awaitConnected());
		RecordingFrameHandler events = new RecordingFrameHandler();
		subscribe(member, shared.projectId(), events);

		HttpResponse<String> acquired = post(owner, "/api/projects/" + shared.projectId() + "/lock", Map.of());
		assertEquals(201, acquired.statusCode(), acquired.body());

		Map<String, Object> event = events.next();
		assertEquals("lock_changed", event.get("type"));
		assertEquals(true, event.get("locked"));
		assertEquals("acquired", event.get("reason"));
		assertEquals(1, ((Number) event.get("epoch")).intValue());
	}

	@Test
	void reconnectReauthenticatesAndResubscribes() throws Exception {
		SharedProject shared = sharedProject("reconnect");
		SessionHandler first = new SessionHandler();
		StompSession firstSession = connect(shared.owner(), ALLOWED_ORIGIN, first);
		assertTrue(first.awaitConnected());
		firstSession.disconnect();

		SessionHandler second = new SessionHandler();
		StompSession secondSession = connect(shared.owner(), ALLOWED_ORIGIN, second);
		assertTrue(second.awaitConnected(), "a reconnect must re-authenticate against the HTTP session");
		RecordingFrameHandler events = new RecordingFrameHandler();
		subscribe(secondSession, shared.projectId(), events);

		HttpResponse<String> acquired = post(shared.owner(), "/api/projects/" + shared.projectId() + "/lock",
				Map.of());
		assertEquals(201, acquired.statusCode(), acquired.body());
		assertEquals("lock_changed", events.next().get("type"));
	}

	@Test
	void logoutAllClosesAffectedSessions() throws Exception {
		SharedProject shared = sharedProject("logout-all");
		SessionHandler handler = new SessionHandler();
		StompSession stomp = connect(shared.owner(), ALLOWED_ORIGIN, handler);
		assertTrue(handler.awaitConnected());
		subscribe(stomp, shared.projectId(), new RecordingFrameHandler());

		HttpResponse<String> loggedOut = post(shared.owner(), "/api/auth/logout-all", Map.of());
		assertEquals(204, loggedOut.statusCode(), loggedOut.body());

		assertTrue(handler.awaitDisconnected(), "logout-all must close the account's realtime sessions");
	}

	@Test
	void memberRemovalClosesAffectedSessions() throws Exception {
		SharedProject shared = sharedProject("removal");
		UserSession member = shared.member();
		UserSession owner = shared.owner();
		SessionHandler handler = new SessionHandler();
		StompSession stomp = connect(member, ALLOWED_ORIGIN, handler);
		assertTrue(handler.awaitConnected());
		RecordingFrameHandler events = new RecordingFrameHandler();
		subscribe(stomp, shared.projectId(), events);

		JsonNode teams = objectMapper.readTree(get(owner, "/api/teams").body());
		String teamId = teams.get(0).get("id").asText();
		JsonNode team = objectMapper.readTree(get(owner, "/api/teams/" + teamId).body());
		String memberId = null;
		for (JsonNode membership : team.get("members")) {
			if (membership.get("email").asText().equals(member.email())) {
				memberId = membership.get("userId").asText();
			}
		}
		assertNotNull(memberId, "the member must be found in the team");
		HttpResponse<String> removed = owner.http()
			.send(HttpRequest.newBuilder(URI.create(base() + "/api/teams/" + teamId + "/members/" + memberId))
				.header(owner.csrfHeader(), owner.csrfToken())
				.DELETE()
				.build(), BodyHandlers.ofString());
		assertEquals(204, removed.statusCode(), removed.body());

		assertTrue(handler.awaitDisconnected(), "member removal must close affected realtime sessions");
	}
}
