<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isUnauthenticated } from '#lib/api/client';
	import {
		createProject,
		emptyProjectDocument,
		importProject,
		listProjects,
		PROJECT_FORMAT,
		rememberProjectDomain,
		type ExportEnvelope,
		type ProjectSummary
	} from '#lib/api/projects';
	import type { Domain } from '#lib/model/circuit';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let projects = $state<ProjectSummary[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let newName = $state('');
	let domainChoice = $state<Domain>('logic');
	let creating = $state(false);
	let importing = $state(false);
	let actionError = $state<string | null>(null);

	function documentDomain(document: unknown): Domain | null {
		if (document === null || typeof document !== 'object') return null;
		const circuit = (document as { circuit?: unknown }).circuit;
		if (circuit === null || typeof circuit !== 'object') return null;
		const value = (circuit as { domain?: unknown }).domain;
		return value === 'logic' || value === 'analog' ? value : null;
	}

	function withImportedDomain(document: unknown): unknown {
		if (document === null || typeof document !== 'object') return document;
		const circuit = (document as { circuit?: unknown }).circuit;
		if (circuit === null || typeof circuit !== 'object') return document;
		const target = circuit as { domain?: unknown };
		// Absent already means logic, so a logic choice leaves a legacy
		// document untouched; only an analog choice needs materializing.
		if (target.domain === undefined && domainChoice !== 'logic') target.domain = domainChoice;
		return document;
	}

	async function load() {
		loading = true;
		loadError = null;
		try {
			projects = await listProjects();
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fprojects');
				return;
			}
			loadError = cause instanceof Error ? cause.message : 'Could not load projects.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		actionError = null;
		if (newName.trim().length === 0) {
			actionError = 'Enter a project name.';
			return;
		}
		creating = true;
		try {
			const project = await createProject(newName.trim(), emptyProjectDocument(domainChoice));
			rememberProjectDomain(project.id, domainChoice);
			await goto(`/projects/${project.id}`);
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fprojects');
				return;
			}
			actionError = cause instanceof Error ? cause.message : 'Could not create the project.';
		} finally {
			creating = false;
		}
	}

	async function importFile(event: Event) {
		actionError = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		try {
			const parsed: unknown = JSON.parse(await file.text());
			if (parsed === null || typeof parsed !== 'object') {
				throw new Error('The file is not a CircuitGate project.');
			}
			const envelope = parsed as ExportEnvelope;
			if (envelope.format !== PROJECT_FORMAT) {
				throw new Error('The file is not a CircuitGate project.');
			}
			const normalized = withImportedDomain(envelope.document);
			const project = await importProject({ ...envelope, document: normalized });
			rememberProjectDomain(project.id, documentDomain(normalized) ?? domainChoice);
			await goto(`/projects/${project.id}`);
		} catch (cause) {
			if (isUnauthenticated(cause)) {
				await goto('/login?redirectTo=%2Fprojects');
				return;
			}
			actionError = cause instanceof Error ? cause.message : 'Could not import the file.';
		} finally {
			importing = false;
			input.value = '';
		}
	}

	function formatDate(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}
</script>

<svelte:head>
	<title>Projects · CircuitGate</title>
</svelte:head>

<div class="dashboard">
	<header>
		<h1>Projects</h1>
		<p class="muted">Signed in as {data.user.email}</p>
	</header>

	<section class="actions">
		<form onsubmit={create}>
			<label class="visually-hidden" for="new-project-name">New project name</label>
			<input id="new-project-name" placeholder="New project name" bind:value={newName} />
			<label class="domain">
				<span class="visually-hidden">Project domain</span>
				<select
					bind:value={domainChoice}
					data-testid="new-project-domain"
					aria-label="Project domain"
				>
					<option value="logic">logic</option>
					<option value="analog">analog</option>
				</select>
			</label>
			<button type="submit" data-testid="create-project" disabled={creating}>
				{creating ? 'Creating…' : 'Create project'}
			</button>
		</form>
		<label class="import">
			<span>Import project</span>
			<input type="file" accept="application/json,.json" data-testid="import-file" onchange={importFile} disabled={importing} />
		</label>
	</section>

	{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

	{#if loading}
		<p role="status">Loading projects…</p>
	{:else if loadError}
		<div class="error" role="alert">
			<p>{loadError}</p>
			<button type="button" onclick={load}>Retry</button>
		</div>
	{:else if projects.length === 0}
		<p class="muted">No projects yet. Create one to start designing.</p>
	{:else}
		<ul class="project-list" data-testid="project-list">
			{#each projects as project (project.id)}
				<li data-testid="project-row">
					<a class="name" data-testid="project-name" href={`/projects/${project.id}`}>{project.name}</a>
					{#if project.domain}
						<span class="tag domain" data-testid="project-domain" data-domain={project.domain}>
							{project.domain}
						</span>
					{/if}
					{#if project.owned === false}
						<span class="tag" data-testid="shared-tag">shared with you</span>
					{/if}
					<span class="muted">version {project.version}</span>
					<span class="muted">updated {formatDate(project.updatedAt)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.dashboard {
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		margin: 16px 0;
	}

	.actions form {
		display: flex;
		gap: 8px;
	}

	.actions input:not([type]),
	.actions select {
		padding: 8px 10px;
		border: 1px solid #b0bec5;
		border-radius: 4px;
		font-size: 14px;
		background: #ffffff;
	}

	.actions .domain {
		display: flex;
		align-items: center;
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

	.import {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #455a64;
	}

	.error {
		padding: 10px;
		border-radius: 6px;
		background: #ffebee;
		color: #b71c1c;
		font-size: 13px;
	}

	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.project-list li {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 10px 12px;
		background: #ffffff;
		border: 1px solid #cfd8dc;
		border-radius: 6px;
	}

	.project-list .name {
		font-weight: 600;
		color: #1565c0;
		text-decoration: none;
	}

	.tag {
		padding: 2px 6px;
		border-radius: 999px;
		background: #e3f2fd;
		color: #1565c0;
		font-size: 11px;
	}

	.tag.domain[data-domain='analog'] {
		background: #ede7f6;
		color: #4527a0;
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
