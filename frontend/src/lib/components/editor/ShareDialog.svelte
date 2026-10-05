<script lang="ts">
	import { apiErrorMessage } from '../../api/client';
	import { listShares, shareProject, unshareProject, type ProjectShare } from '../../api/sharing';
	import { listTeams, type TeamSummary } from '../../api/teams';

	interface Props {
		projectId: string;
		projectName: string;
		open: boolean;
		onClose: () => void;
	}

	let { projectId, projectName, open, onClose }: Props = $props();

	let teams = $state<TeamSummary[]>([]);
	let shares = $state<ProjectShare[]>([]);
	let selectedTeamId = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let loading = $state(false);

	const availableTeams = $derived(
		teams.filter((team) => !shares.some((share) => share.teamId === team.id))
	);

	$effect(() => {
		if (!open) return;
		void load();
	});

	async function load() {
		loading = true;
		error = null;
		try {
			const [teamList, shareList] = await Promise.all([listTeams(), listShares(projectId)]);
			teams = teamList;
			shares = shareList;
		} catch (cause) {
			error = apiErrorMessage(cause);
		} finally {
			loading = false;
		}
	}

	async function addShare() {
		if (!selectedTeamId) return;
		busy = true;
		error = null;
		try {
			await shareProject(projectId, selectedTeamId);
			selectedTeamId = '';
			await load();
		} catch (cause) {
			error = apiErrorMessage(cause);
		} finally {
			busy = false;
		}
	}

	async function removeShare(teamId: string) {
		busy = true;
		error = null;
		try {
			await unshareProject(projectId, teamId);
			await load();
		} catch (cause) {
			error = apiErrorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

{#if open}
	<div class="overlay" data-testid="share-dialog">
		<div class="dialog" role="dialog" aria-modal="true" aria-label="Share project">
			<h2>Share “{projectName}”</h2>
			<p class="muted">Team members can open and edit this project, one editor at a time.</p>

			{#if loading}
				<p role="status">Loading teams…</p>
			{:else}
				<ul class="shares">
					{#each shares as share (share.teamId)}
						<li data-testid="share-row">
							<span class="team-name">{share.teamName}</span>
							<button
								type="button"
								data-testid="share-remove"
								onclick={() => removeShare(share.teamId)}
								disabled={busy}
							>
								Remove
							</button>
						</li>
					{/each}
					{#if shares.length === 0}
						<li class="muted">Not shared with any team yet.</li>
					{/if}
				</ul>

				<div class="add">
					<select bind:value={selectedTeamId} data-testid="share-team-select" aria-label="Team">
						<option value="">Select a team</option>
						{#each availableTeams as team (team.id)}
							<option value={team.id}>{team.name}</option>
						{/each}
					</select>
					<button
						type="button"
						data-testid="share-add"
						onclick={addShare}
						disabled={busy || selectedTeamId === ''}
					>
						Share with team
					</button>
				</div>
			{/if}

			{#if error}<p class="error" role="alert" data-testid="share-error">{error}</p>{/if}

			<div class="actions">
				<button type="button" data-testid="share-close" onclick={onClose}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgb(38 50 56 / 45%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 20;
	}

	.dialog {
		width: min(420px, calc(100vw - 32px));
		background: #ffffff;
		border-radius: 8px;
		padding: 16px;
		box-shadow: 0 12px 32px rgb(0 0 0 / 25%);
	}

	h2 {
		margin: 0 0 6px;
		font-size: 16px;
	}

	.muted {
		color: #607d8b;
		font-size: 12px;
	}

	.shares {
		list-style: none;
		margin: 12px 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.shares li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 8px;
		background: #f5f7f8;
		border: 1px solid #cfd8dc;
		border-radius: 4px;
		font-size: 13px;
	}

	.add {
		display: flex;
		gap: 8px;
	}

	.add select {
		flex: 1;
		padding: 6px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
	}

	button {
		padding: 6px 10px;
		border: 1px solid #90a4ae;
		border-radius: 4px;
		background: #1565c0;
		color: #ffffff;
		font-size: 12px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 12px;
	}

	.actions button {
		background: #ffffff;
		color: #263238;
	}

	.error {
		margin: 10px 0 0;
		color: #c62828;
		font-size: 12px;
	}
</style>
