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
		padding: 20px;
		background: #eceff1;
		overflow: auto;
	}

	header h1 {
		margin: 0;
		font-size: 24px;
		color: #263238;
	}

	.muted {
		color: #607d8b;
		font-size: 13px;
	}

	.actions {
		margin: 16px 0;
	}

	.actions form {
		display: flex;
		gap: 8px;
	}

	.actions input:not([type]) {
		padding: 8px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 14px;
	}

	button {
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		background: #1565c0;
		color: #ffffff;
		font-size: 14px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.error {
		padding: 10px;
		border-radius: 6px;
		background: #ffebee;
		color: #b71c1c;
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
		padding: 14px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
	}

	.detail {
		flex: 1;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 16px;
		color: #37474f;
	}

	.team-list,
	.member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.team-list li,
	.member-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid #e0e0e0;
		border-radius: 4px;
	}

	.team-list .name {
		background: transparent;
		color: #1565c0;
		padding: 0;
		font-weight: 600;
	}

	.role-badge {
		margin-left: auto;
		padding: 2px 8px;
		border-radius: 10px;
		background: #e3f2fd;
		color: #1565c0;
		font-size: 12px;
	}

	.member-email {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add-member {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}

	.add-member input {
		flex: 1;
		padding: 8px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 14px;
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
