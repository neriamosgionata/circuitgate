package dev.circuitgate.sharing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;

import dev.circuitgate.TestcontainersConfiguration;
import dev.circuitgate.support.ProjectFeatureTestSupport;

import tools.jackson.databind.JsonNode;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SharingAccessTest extends ProjectFeatureTestSupport {

	private static String unique(String local) {
		return local + "-" + UUID.randomUUID() + "@example.test";
	}

	@Test
	void sharingWithATeamGrantsMembersAccessAndNonMembersAreDenied() throws Exception {
		String ownerEmail = unique("share-owner");
		String memberEmail = unique("share-member");
		String outsiderEmail = unique("share-outsider");
		Client alice = client(ownerEmail);
		Client bob = client(memberEmail);
		Client carol = client(outsiderEmail);
		UUID projectId = createProject(alice, "shared-project");
		UUID teamId = createTeam(alice, "Study group");
		addMember(alice, teamId, memberEmail);

		MvcResult shared = share(alice, projectId, teamId);
		assertEquals(201, shared.getResponse().getStatus(), shared.getResponse().getContentAsString());

		assertEquals(200, getJson("/api/projects/" + projectId, bob.session()).andReturn().getResponse().getStatus(),
				"a team member must be able to read a shared project");
		assertEquals(404, getJson("/api/projects/" + projectId, carol.session()).andReturn().getResponse().getStatus(),
				"a non-member must not see a project shared with another team");
	}

	@Test
	void sharedProjectsAppearInTheMembersListAsNotOwned() throws Exception {
		String ownerEmail = unique("share-list-owner");
		String memberEmail = unique("share-list-member");
		Client alice = client(ownerEmail);
		Client bob = client(memberEmail);
		UUID projectId = createProject(alice, "listed-share");
		UUID teamId = createTeam(alice, "List team");
		addMember(alice, teamId, memberEmail);
		assertEquals(201, share(alice, projectId, teamId).getResponse().getStatus());

		JsonNode projects = body(getJson("/api/projects", bob.session()).andReturn());
		assertEquals(1, projects.size());
		assertEquals(projectId.toString(), projects.get(0).get("id").asText());
		assertFalse(projects.get(0).get("owned").asBoolean());
		assertEquals(userId(ownerEmail).toString(), projects.get(0).get("ownerId").asText());

		JsonNode shares = body(getJson("/api/projects/" + projectId + "/shares", bob.session()).andReturn());
		assertEquals(1, shares.size());
		assertEquals(teamId.toString(), shares.get(0).get("teamId").asText());
	}

	@Test
	void onlyTheOwnerMayCreateOrRemoveShares() throws Exception {
		String ownerEmail = unique("share-owner-rights");
		String memberEmail = unique("share-member-rights");
		Client alice = client(ownerEmail);
		Client bob = client(memberEmail);
		UUID projectId = createProject(alice, "owner-only-shares");
		UUID sharedTeam = createTeam(alice, "Shared team");
		UUID otherTeam = createTeam(bob, "Bob team");
		addMember(alice, sharedTeam, memberEmail);
		assertEquals(201, share(alice, projectId, sharedTeam).getResponse().getStatus());

		MvcResult memberShare = share(bob, projectId, otherTeam);
		assertEquals(404, memberShare.getResponse().getStatus(),
				"membership alone must never grant sharing rights: " + memberShare.getResponse().getContentAsString());
		MvcResult memberUnshare = deleteJson("/api/projects/" + projectId + "/shares/" + sharedTeam, bob).andReturn();
		assertEquals(404, memberUnshare.getResponse().getStatus(),
				"membership alone must never grant unshare rights: " + memberUnshare.getResponse().getContentAsString());
		assertEquals(1, body(getJson("/api/projects/" + projectId + "/shares", alice.session()).andReturn()).size(),
				"the member's rejected attempts must not change shares");

		MvcResult ownerUnshare = deleteJson("/api/projects/" + projectId + "/shares/" + sharedTeam, alice).andReturn();
		assertEquals(204, ownerUnshare.getResponse().getStatus(), ownerUnshare.getResponse().getContentAsString());
		assertEquals(404, getJson("/api/projects/" + projectId, bob.session()).andReturn().getResponse().getStatus());
	}

	@Test
	void savingASharedProjectRequiresTheCurrentLock() throws Exception {
		String ownerEmail = unique("share-save-owner");
		String memberEmail = unique("share-save-member");
		Client alice = client(ownerEmail);
		Client bob = client(memberEmail);
		UUID projectId = createProject(alice, "shared-save");
		UUID teamId = createTeam(alice, "Save team");
		addMember(alice, teamId, memberEmail);
		assertEquals(201, share(alice, projectId, teamId).getResponse().getStatus());

		long epoch = acquireEpoch(bob, projectId);
		MvcResult memberSave = putJson("/api/projects/" + projectId,
				saveBody("shared-save", document("bob-edit"), 1, epoch), bob)
			.andReturn();
		assertEquals(200, memberSave.getResponse().getStatus(), memberSave.getResponse().getContentAsString());
		assertEquals(2, body(memberSave).get("version").asLong());

		MvcResult ownerSave = putJson("/api/projects/" + projectId, saveBody("shared-save", document("alice-edit"), 2),
				alice)
			.andReturn();
		assertEquals(409, ownerSave.getResponse().getStatus(), ownerSave.getResponse().getContentAsString());
		assertEquals("lock_conflict", body(ownerSave).get("error").asText(),
				"a save from a non-holder must be rejected");

		MvcResult staleEpochSave = putJson("/api/projects/" + projectId,
				saveBody("shared-save", document("alice-edit"), 2, epoch + 1), alice)
			.andReturn();
		assertEquals(409, staleEpochSave.getResponse().getStatus(), staleEpochSave.getResponse().getContentAsString());
		assertEquals("lock_conflict", body(staleEpochSave).get("error").asText());

		assertEquals(204, releaseLock(bob, projectId, epoch).getResponse().getStatus());
		long aliceEpoch = acquireEpoch(alice, projectId);
		MvcResult ownerSaveAfterAcquire = putJson("/api/projects/" + projectId,
				saveBody("shared-save", document("alice-edit"), 2, aliceEpoch), alice)
			.andReturn();
		assertEquals(200, ownerSaveAfterAcquire.getResponse().getStatus(),
				ownerSaveAfterAcquire.getResponse().getContentAsString());
	}

	@Test
	void unsharingForceReleasesTheMembersLock() throws Exception {
		String ownerEmail = unique("share-unshare-owner");
		String memberEmail = unique("share-unshare-member");
		Client alice = client(ownerEmail);
		Client bob = client(memberEmail);
		UUID projectId = createProject(alice, "unshare-release");
		UUID teamId = createTeam(alice, "Unshare team");
		addMember(alice, teamId, memberEmail);
		assertEquals(201, share(alice, projectId, teamId).getResponse().getStatus());
		long epoch = acquireEpoch(bob, projectId);
		assertTrue(lockActiveFor(projectId, userId(memberEmail)));

		assertEquals(204,
				deleteJson("/api/projects/" + projectId + "/shares/" + teamId, alice).andReturn().getResponse()
					.getStatus());

		assertFalse(lockActive(projectId), "unsharing must force-release the member's lock in the same transaction");
		assertEquals(epoch + 1, lockEpoch(projectId));
		assertEquals(404, getJson("/api/projects/" + projectId, bob.session()).andReturn().getResponse().getStatus());
	}

	@Test
	void removingAMemberForceReleasesTheirLocksOnTeamProjects() throws Exception {
		String ownerEmail = unique("share-remove-owner");
		String memberEmail = unique("share-remove-member");
		Client alice = client(ownerEmail);
		Client bob = client(memberEmail);
		UUID projectId = createProject(alice, "removal-release");
		UUID teamId = createTeam(alice, "Removal team");
		addMember(alice, teamId, memberEmail);
		assertEquals(201, share(alice, projectId, teamId).getResponse().getStatus());
		long epoch = acquireEpoch(bob, projectId);

		MvcResult removed = deleteJson("/api/teams/" + teamId + "/members/" + userId(memberEmail), alice).andReturn();
		assertEquals(204, removed.getResponse().getStatus(), removed.getResponse().getContentAsString());

		assertFalse(lockActive(projectId), "member removal must force-release the member's lock");
		assertEquals(epoch + 1, lockEpoch(projectId));
		assertEquals(404, getJson("/api/projects/" + projectId, bob.session()).andReturn().getResponse().getStatus());
	}
}
