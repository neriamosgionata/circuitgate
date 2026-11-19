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

	function initials(email: string): string {
		return email.slice(0, 2).toUpperCase();
	}
</script>

<svelte:head>
	<title>Teams · CircuitGate</title>
</svelte:head>

<div class="page-frame">
	<header class="page-head">
		<div>
			<h1>Teams</h1>
			<p class="lede">Share project sheets with classmates. Members join by verified email address.</p>
		</div>
	</header>

	<section class="create-strip sheet" aria-labelledby="create-team-heading">
		<h2 id="create-team-heading">New team</h2>
		<form onsubmit={create}>
			<label class="visually-hidden" for="new-team-name">New team name</label>
			<input id="new-team-name" placeholder="New team name" bind:value={newName} autocomplete="off" />
			<button type="submit" class="primary" data-testid="create-team" disabled={creating}>
				{creating ? 'Creating…' : 'Create team'}
			</button>
		</form>
	</section>

	{#if actionError}<p class="error" role="alert" data-testid="team-error">{actionError}</p>{/if}

	{#if loading}
		<div class="workspace">
			<section class="sheet panel">
				<div class="sheet-head"><h2>Your teams</h2></div>
				<div class="sheet-body">
					<p class="skeleton skeleton-line" aria-hidden="true"></p>
					<p class="skeleton skeleton-line short" aria-hidden="true"></p>
				</div>
			</section>
			<p class="visually-hidden" role="status">Loading teams…</p>
		</div>
	{:else if loadError}
		<div class="error sheet" role="alert">
			<p>{loadError}</p>
			<button type="button" onclick={load}>Retry</button>
		</div>
	{:else}
		<div class="workspace">
			<section class="sheet panel" aria-labelledby="teams-heading">
				<div class="sheet-head">
					<h2 id="teams-heading">Your teams</h2>
					<span class="note">{teams.length} joined</span>
				</div>
				{#if teams.length === 0}
					<div class="empty">
						<p class="muted" data-testid="team-empty">No teams yet. Create one to start collaborating.</p>
					</div>
				{:else}
					<ul class="team-list" data-testid="team-list">
						{#each teams as team (team.id)}
							<li
								class="team-row"
								class:active={selected?.id === team.id}
								data-testid="team-row"
							>
								<span class="monogram" aria-hidden="true">{initials(team.name)}</span>
								<button
									type="button"
									class="name"
									data-testid="team-name"
									onclick={() => openTeam(team.id)}
									aria-pressed={selected?.id === team.id}
								>
									{team.name}
								</button>
								<span class="chip">{team.role}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if selected}
				<section class="sheet detail" data-testid="team-detail" aria-labelledby="team-detail-heading">
					<div class="sheet-head">
						<h2 id="team-detail-heading">{selected.name}</h2>
						<span class="note">
							{selected.members.length} {selected.members.length === 1 ? 'member' : 'members'}
						</span>
					</div>
					<div class="detail-body">
						<p class="muted">
							Your role: <span class="chip" data-testid="team-role">{selected.role}</span>
						</p>

						{#if selected.role === 'owner'}
							<form class="add-member" onsubmit={addMember}>
								<label class="visually-hidden" for="member-email">Member email</label>
								<input id="member-email" type="email" placeholder="Member email" bind:value={memberEmail} />
								<button type="submit" data-testid="add-member" disabled={adding}>
									{adding ? 'Adding…' : 'Add member'}
								</button>
							</form>
						{:else}
							<p class="muted note-line">Only the team owner can add or remove members.</p>
						{/if}

						<ul class="member-list" data-testid="member-list">
							{#each selected.members as member (member.userId)}
								<li data-testid="member-row">
									<span class="member-monogram" aria-hidden="true">{initials(member.email)}</span>
									<div class="member-main">
										<span class="member-email" data-testid="member-email">{member.email}</span>
									</div>
									<span class="chip">{member.role}</span>
									{#if selected.role === 'owner' && member.role !== 'owner'}
										<button
											type="button"
											class="danger"
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
					</div>
				</section>
			{:else}
				<section class="sheet detail detail-empty">
					<div class="sheet-head"><h2>Team sheet</h2></div>
					<div class="detail-body">
						<p class="muted">
							Select a team from the list to see its members, or create a team above.
						</p>
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.page-head {
		margin-bottom: 20px;
	}

	.create-strip {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px 16px;
		padding: 14px;
		margin-bottom: 20px;
	}

	.create-strip h2 {
		margin: 0;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.create-strip form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.create-strip input {
		flex: 1 1 220px;
		min-width: 0;
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
		gap: 20px;
		align-items: start;
	}

	.panel {
		overflow: hidden;
	}

	.empty {
		padding: 18px 14px;
	}

	.team-list {
		list-style: none;
		margin: 0;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.team-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		transition:
			background-color 120ms linear,
			border-color 120ms linear;
	}

	.team-row:hover {
		background: var(--paper-soft);
	}

	.team-row.active {
		background: var(--accent-soft);
		border-color: var(--accent-line);
	}

	.monogram,
	.member-monogram {
		display: grid;
		place-items: center;
		flex: none;
		width: 28px;
		height: 28px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.04em;
		border: 1px solid var(--accent-line);
		border-radius: var(--radius-sm);
	}

	.member-monogram {
		width: 30px;
		height: 30px;
		background: var(--paper-sunk);
		color: var(--ink-soft);
		border-color: var(--rule);
	}

	.team-row .name {
		flex: 1;
		min-width: 0;
		min-height: 0;
		padding: 0;
		justify-content: flex-start;
		background: transparent;
		border: 0;
		color: var(--ink);
		font-family: var(--font-ui);
		font-size: 14.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-align: left;
		text-transform: none;
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.detail .sheet-head h2 {
		text-transform: none;
		letter-spacing: -0.01em;
		font-size: 15px;
		font-weight: 650;
		color: var(--ink);
	}

	.team-row .name:hover:not(:disabled) {
		background: transparent;
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.detail-body {
		padding: 14px;
	}

	.detail-body > .muted {
		margin: 0 0 12px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.add-member {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 14px;
	}

	.add-member input {
		flex: 1 1 220px;
		min-width: 0;
	}

	.note-line {
		font-size: 12.5px;
	}

	.member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--rule);
	}

	.member-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 2px;
		border-bottom: 1px solid var(--rule);
	}

	.member-list li:last-child {
		border-bottom: 0;
	}

	.member-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.member-email {
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
	}

	.member-list button {
		min-height: 30px;
		padding: 4px 10px;
		font-size: 12px;
	}

	.detail-empty .detail-body {
		padding: 24px 14px;
	}

	.detail-empty .muted {
		margin: 0;
		max-width: 44ch;
	}

	@media (max-width: 800px) {
		.workspace {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 480px) {
		.create-strip h2 {
			width: 100%;
		}

		.create-strip input,
		.create-strip button {
			width: 100%;
			flex-basis: 100%;
		}
	}
</style>
