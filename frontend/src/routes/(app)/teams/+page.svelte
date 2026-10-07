<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isUnauthenticated } from '#lib/api/client';
	import {
		addTeamMember,
		createTeam,
		getTeam,
		listTeams,
		removeTeamMember,
		teamErrorMessage,
		type TeamDetail,
		type TeamSummary
	} from '#lib/api/teams';

	let teams = $state<TeamSummary[]>([]);
	let selected = $state<TeamDetail | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let newName = $state('');
	let memberEmail = $state('');
	let creating = $state(false);
	let adding = $state(false);
	let busyMemberId = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	async function load() {
		loading = true;
		loadError = null;
		try {
			teams = await listTeams();
			if (selected && !teams.some((team) => team.id === selected?.id)) {
				selected = null;
			}
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fteams');
				return;
			}
			loadError = cause instanceof Error ? cause.message : 'Could not load teams.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function openTeam(id: string) {
		actionError = null;
		try {
			selected = await getTeam(id);
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fteams');
				return;
			}
			actionError = teamErrorMessage(cause);
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		actionError = null;
		if (newName.trim().length === 0) {
			actionError = 'Enter a team name.';
			return;
		}
		creating = true;
		try {
			selected = await createTeam(newName.trim());
			newName = '';
			await load();
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fteams');
				return;
			}
			actionError = teamErrorMessage(cause);
		} finally {
			creating = false;
		}
	}

	async function addMember(event: SubmitEvent) {
		event.preventDefault();
		actionError = null;
		const team = selected;
		if (!team) return;
		if (memberEmail.trim().length === 0) {
			actionError = 'Enter an email address.';
			return;
		}
		adding = true;
		try {
			await addTeamMember(team.id, memberEmail.trim());
			memberEmail = '';
			selected = await getTeam(team.id);
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fteams');
				return;
			}
			actionError = teamErrorMessage(cause);
		} finally {
			adding = false;
		}
	}

	async function removeMember(userId: string) {
		actionError = null;
		const team = selected;
		if (!team) return;
		busyMemberId = userId;
		try {
			await removeTeamMember(team.id, userId);
			selected = await getTeam(team.id);
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fteams');
				return;
			}
			actionError = teamErrorMessage(cause);
		} finally {
			busyMemberId = null;
		}
	}
</script>

<svelte:head>
	<title>Teams · CircuitGate</title>
</svelte:head>

<div class="teams">
	<header>
		<h1>Teams</h1>
		<p class="muted">Create a team and add members by their verified email address.</p>
	</header>

	<section class="actions">
		<form onsubmit={create}>
			<label class="visually-hidden" for="new-team-name">New team name</label>
			<input id="new-team-name" placeholder="New team name" bind:value={newName} />
			<button type="submit" data-testid="create-team" disabled={creating}>
				{creating ? 'Creating…' : 'Create team'}
			</button>
		</form>
	</section>

	{#if actionError}<p class="error" role="alert" data-testid="team-error">{actionError}</p>{/if}

	{#if loading}
		<p role="status">Loading teams…</p>
	{:else if loadError}
		<div class="error" role="alert">
			<p>{loadError}</p>
			<button type="button" onclick={load}>Retry</button>
		</div>
	{:else}
		<div class="layout">
			<section class="team-panel">
				<h2>Your teams</h2>
				{#if teams.length === 0}
					<p class="muted" data-testid="team-empty">No teams yet. Create one to start collaborating.</p>
				{:else}
					<ul class="team-list" data-testid="team-list">
						{#each teams as team (team.id)}
							<li data-testid="team-row">
								<button type="button" class="name" data-testid="team-name" onclick={() => openTeam(team.id)}>
									{team.name}
								</button>
								<span class="role-badge">{team.role}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if selected}
				<section class="detail" data-testid="team-detail">
					<h2>{selected.name}</h2>
					<p class="muted">Your role: <span data-testid="team-role">{selected.role}</span></p>

					{#if selected.role === 'owner'}
						<form class="add-member" onsubmit={addMember}>
							<label class="visually-hidden" for="member-email">Member email</label>
							<input id="member-email" type="email" placeholder="Member email" bind:value={memberEmail} />
							<button type="submit" data-testid="add-member" disabled={adding}>
								{adding ? 'Adding…' : 'Add member'}
							</button>
						</form>
					{/if}

					<ul class="member-list" data-testid="member-list">
						{#each selected.members as member (member.userId)}
							<li data-testid="member-row">
								<span class="member-email" data-testid="member-email">{member.email}</span>
								<span class="role-badge">{member.role}</span>
								{#if selected.role === 'owner' && member.role !== 'owner'}
									<button
										type="button"
										data-testid="remove-member"
										disabled={busyMemberId === member.userId}
										onclick={() => removeMember(member.userId)}
									>
										{busyMemberId === member.userId ? 'Removing…' : 'Remove'}
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.teams {
		flex: 1;
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
		padding: 18px clamp(14px, 4vw, 36px) 30px;
		overflow: auto;
	}

	.teams > header h1 {
		margin: 0;
		font-size: 30px;
	}

	.muted {
		color: var(--ink-soft);
		font-size: 13px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 10px;
		margin: 16px 0 14px;
		padding: 10px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		box-shadow: var(--shadow-sheet);
	}

	.actions form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.error {
		padding: 10px;
		border: 2px solid var(--stamp-red);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-red);
		font-size: 13px;
	}

	.layout {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}

	.team-panel,
	.detail {
		min-width: 280px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		box-shadow: var(--shadow-sheet);
		overflow: hidden;
	}

	.team-panel {
		flex: 0 1 340px;
	}

	.team-panel h2,
	.detail h2 {
		margin: 0;
		padding: 8px 14px;
		border-bottom: var(--rule-hair);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.35), transparent);
		font-size: 16px;
		color: var(--ink);
	}

	.team-panel .muted,
	.detail > .muted,
	.detail > form {
		padding: 0 14px;
	}

	.detail > form:last-child {
		padding-bottom: 14px;
	}

	.team-list,
	.member-list {
		list-style: none;
		margin: 0;
		padding: 10px 14px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.team-list li,
	.member-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px 8px 14px;
		background: var(--sheet-raised);
		border: var(--rule-hair);
		border-radius: 2px;
		position: relative;
	}

	.team-list li::before,
	.member-list li::before {
		content: '';
		position: absolute;
		left: 5px;
		top: 7px;
		bottom: 7px;
		width: 3px;
		border-radius: 1px;
		background: var(--highlight);
	}

	.team-list .name {
		background: transparent;
		border: none;
		color: var(--ink);
		padding: 0;
		font-family: var(--font-head);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: none;
		text-align: left;
	}

	.team-list .name:hover:not(:disabled) {
		background: transparent;
		color: var(--biro);
	}

	.role-badge {
		margin-left: auto;
		padding: 2px 7px;
		border: 1px solid var(--rule);
		border-radius: 2px;
		background: transparent;
		color: var(--ink-soft);
		font-family: var(--font-head);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.member-email {
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono);
		font-size: 13px;
	}

	.add-member {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}

	.add-member input {
		flex: 1;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
