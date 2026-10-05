package dev.circuitgate.team;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import dev.circuitgate.TestcontainersConfiguration;

import tools.jackson.databind.JsonNode;

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
class TeamMembershipTest extends TeamApiTestSupport {

	private static String unique(String local) {
		return local + "-" + UUID.randomUUID() + "@example.test";
	}

	@Test
	void creatingTeamMakesCreatorOwner() throws Exception {
		String owner = unique("owner-create");
		Client alice = client(owner);
		UUID aliceId = userId(owner);

		MvcResult created = postJson("/api/teams", Map.of("name", "Alpha"), alice).andReturn();
		assertEquals(201, created.getResponse().getStatus(), created.getResponse().getContentAsString());
		JsonNode team = body(created);
		assertEquals("Alpha", team.get("name").asText());
		assertEquals(aliceId.toString(), team.get("ownerId").asText());
		assertEquals("owner", team.get("role").asText());
		assertEquals(1, team.get("members").size());
		assertEquals(aliceId.toString(), team.get("members").get(0).get("userId").asText());
		assertEquals(owner, team.get("members").get(0).get("email").asText());
		assertEquals("owner", team.get("members").get(0).get("role").asText());
		assertEquals(1, membershipCount(UUID.fromString(team.get("id").asText()), aliceId));

		MvcResult list = getJson("/api/teams", alice.session()).andReturn();
		assertEquals(200, list.getResponse().getStatus(), list.getResponse().getContentAsString());
		JsonNode listBody = body(list);
		assertEquals(1, listBody.size());
		assertEquals(team.get("id").asText(), listBody.get(0).get("id").asText());
		assertEquals("owner", listBody.get(0).get("role").asText());
	}

	@Test
	void addingVerifiedUserByEmailCreatesMembership() throws Exception {
		String owner = unique("owner-add");
		String member = unique("member-add");
		Client alice = client(owner);
		UUID bobId = createUser(member, true);
		UUID teamId = createTeam(alice, "Alpha");

		MvcResult added = postJson("/api/teams/" + teamId + "/members", Map.of("email", member), alice).andReturn();
		assertEquals(201, added.getResponse().getStatus(), added.getResponse().getContentAsString());
		JsonNode addedBody = body(added);
		assertEquals(bobId.toString(), addedBody.get("userId").asText());
		assertEquals(member, addedBody.get("email").asText());
		assertEquals("member", addedBody.get("role").asText());
		assertEquals(1, membershipCount(teamId, bobId));

		Cookie bob = login(member);
		MvcResult read = getJson("/api/teams/" + teamId, bob).andReturn();
		assertEquals(200, read.getResponse().getStatus(), read.getResponse().getContentAsString());
		JsonNode detail = body(read);
		assertEquals("member", detail.get("role").asText());
		assertEquals(2, detail.get("members").size());
	}

	@Test
	void unknownOrUnverifiedEmailIsRejectedWithTheSameNonLeakingError() throws Exception {
		String owner = unique("owner-unknown");
		String member = unique("member-unknown");
		String unverified = unique("unverified-unknown");
		Client alice = client(owner);
		createUser(member, true);
		createUser(unverified, false);
		UUID teamId = createTeam(alice, "Alpha");

		MvcResult unknown = postJson("/api/teams/" + teamId + "/members",
				Map.of("email", "ghost-unknown@example.test"), alice).andReturn();
		MvcResult unverifiedResult = postJson("/api/teams/" + teamId + "/members", Map.of("email", unverified), alice)
			.andReturn();

		assertEquals(404, unknown.getResponse().getStatus(), unknown.getResponse().getContentAsString());
		assertEquals(unknown.getResponse().getStatus(), unverifiedResult.getResponse().getStatus());
		assertEquals("member_not_available", body(unknown).get("error").asText());
		assertEquals(body(unknown), body(unverifiedResult), "known and unknown emails must be indistinguishable");
		assertEquals(1, memberRowCount(teamId), "a rejected add must not create a membership");
	}

	@Test
	void ownerRemovesMemberAndRemovedMemberLosesAccess() throws Exception {
		String owner = unique("owner-remove");
		String member = unique("member-remove");
		Client alice = client(owner);
		UUID bobId = createUser(member, true);
		UUID teamId = createTeam(alice, "Alpha");
		addMember(alice, teamId, member);

		Cookie bob = login(member);
		assertEquals(200, getJson("/api/teams/" + teamId, bob).andReturn().getResponse().getStatus());

		MvcResult removed = deleteJson("/api/teams/" + teamId + "/members/" + bobId, alice).andReturn();
		assertEquals(204, removed.getResponse().getStatus(), removed.getResponse().getContentAsString());
		assertEquals(0, membershipCount(teamId, bobId));

		MvcResult read = getJson("/api/teams/" + teamId, bob).andReturn();
		assertEquals(404, read.getResponse().getStatus(), read.getResponse().getContentAsString());
		JsonNode list = body(getJson("/api/teams", bob).andReturn());
		assertEquals(0, list.size(), "a removed member must not see the team in their list");
	}

	@Test
	void nonMembersCannotReadTeamDetailsOrMembership() throws Exception {
		String owner = unique("owner-nonmember");
		String member = unique("member-nonmember");
		String outsider = unique("outsider-nonmember");
		Client alice = client(owner);
		Client bob = client(member);
		Client carol = client(outsider);
		UUID teamId = createTeam(alice, "Alpha");
		addMember(alice, teamId, member);

		MvcResult read = getJson("/api/teams/" + teamId, carol.session()).andReturn();
		assertEquals(404, read.getResponse().getStatus(), read.getResponse().getContentAsString());
		JsonNode list = body(getJson("/api/teams", carol.session()).andReturn());
		assertEquals(0, list.size());

		MvcResult memberAdd = postJson("/api/teams/" + teamId + "/members", Map.of("email", outsider), bob)
			.andReturn();
		assertEquals(404, memberAdd.getResponse().getStatus(), memberAdd.getResponse().getContentAsString());
		assertEquals(0, membershipCount(teamId, userId(outsider)));

		MvcResult outsiderRemove = deleteJson("/api/teams/" + teamId + "/members/" + userId(member), carol)
			.andReturn();
		assertEquals(404, outsiderRemove.getResponse().getStatus(), outsiderRemove.getResponse().getContentAsString());
		assertEquals(1, membershipCount(teamId, userId(member)));
	}

	@Test
	void concurrentAddsOfTheSameMemberProduceExactlyOneMembership() throws Exception {
		String owner = unique("owner-concurrent");
		String member = unique("member-concurrent");
		Client alice = client(owner);
		UUID bobId = createUser(member, true);
		UUID teamId = createTeam(alice, "Alpha");

		Cookie secondSession = login(owner);
		Csrf secondCsrf = fetchCsrf(secondSession);

		ExecutorService pool = Executors.newFixedThreadPool(2);
		try {
			Callable<Integer> first = () -> postJson("/api/teams/" + teamId + "/members", Map.of("email", member),
					alice).andReturn().getResponse().getStatus();
			Callable<Integer> second = () -> postJson("/api/teams/" + teamId + "/members", Map.of("email", member),
					secondSession, secondCsrf).andReturn().getResponse().getStatus();
			Future<Integer> firstResult = pool.submit(first);
			Future<Integer> secondResult = pool.submit(second);
			int firstStatus = firstResult.get(30, TimeUnit.SECONDS);
			int secondStatus = secondResult.get(30, TimeUnit.SECONDS);
			assertTrue(firstStatus == 200 || firstStatus == 201, "unexpected status " + firstStatus);
			assertTrue(secondStatus == 200 || secondStatus == 201, "unexpected status " + secondStatus);
		}
		finally {
			pool.shutdownNow();
		}

		assertEquals(1, membershipCount(teamId, bobId), "concurrent adds must yield exactly one membership");
		assertEquals(2, memberRowCount(teamId), "owner plus one member");
	}

	@Test
	void ownerCannotBeRemoved() throws Exception {
		String owner = unique("owner-protected");
		Client alice = client(owner);
		UUID aliceId = userId(owner);
		UUID teamId = createTeam(alice, "Alpha");

		MvcResult removed = deleteJson("/api/teams/" + teamId + "/members/" + aliceId, alice).andReturn();
		assertEquals(409, removed.getResponse().getStatus(), removed.getResponse().getContentAsString());
		assertEquals("owner_cannot_be_removed", body(removed).get("error").asText());
		assertEquals(1, membershipCount(teamId, aliceId));
		assertEquals(200, getJson("/api/teams/" + teamId, alice.session()).andReturn().getResponse().getStatus());
	}

	@Test
	void teamEndpointsRequireAuthenticationAndCsrf() throws Exception {
		String owner = unique("owner-auth");
		String member = unique("member-auth");
		Client alice = client(owner);
		Csrf anonymous = fetchCsrf(null);
		UUID teamId = createTeam(alice, "Alpha");
		createUser(member, true);

		assertEquals(401, getJson("/api/teams", null).andReturn().getResponse().getStatus());
		assertEquals(401, getJson("/api/teams/" + teamId, null).andReturn().getResponse().getStatus());
		assertEquals(401, postJson("/api/teams", Map.of("name", "Anonymous"), anonymous.session(), anonymous)
			.andReturn().getResponse().getStatus());

		MvcResult noCsrf = mvc
			.perform(post("/api/teams").contentType(MediaType.APPLICATION_JSON)
				.content(objectMapper.writeValueAsString(Map.of("name", "No CSRF")))
				.cookie(alice.session()))
			.andReturn();
		assertEquals(403, noCsrf.getResponse().getStatus(), noCsrf.getResponse().getContentAsString());
		assertEquals(1, teamCount(owner));

		MvcResult noCsrfMember = mvc
			.perform(post("/api/teams/" + teamId + "/members").contentType(MediaType.APPLICATION_JSON)
				.content(objectMapper.writeValueAsString(Map.of("email", member)))
				.cookie(alice.session()))
			.andReturn();
		assertEquals(403, noCsrfMember.getResponse().getStatus());
		assertEquals(0, membershipCount(teamId, userId(member)));
	}
}
