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
		background: rgba(16, 24, 32, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 20;
		padding: 16px;
	}

	.dialog {
		width: min(460px, 100%);
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: 22px;
		box-shadow: var(--shadow-2);
	}

	h2 {
		margin: 0 0 4px;
		font-size: 19px;
		line-height: 1.2;
	}

	.muted {
		color: var(--ink-soft);
		font-size: 12.5px;
	}

	p.muted {
		margin: 0 0 14px;
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
		padding: 8px 10px;
		background: var(--paper-soft);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 14px;
		border-top: 1px solid var(--rule);
	}

	.add select {
		flex: 1 1 180px;
		min-width: 0;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 16px;
	}

	.error {
		margin: 10px 0 0;
		padding: 8px 10px;
		border: 1px solid #e6b6b1;
		border-radius: var(--radius-sm);
		background: var(--danger-soft);
		color: #8f1f16;
		font-size: 12.5px;
	}
</style>
