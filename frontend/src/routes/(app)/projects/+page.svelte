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
		width: 100%;
		max-width: 1080px;
		margin: 0 auto;
		padding: 18px clamp(14px, 4vw, 36px) 30px;
		overflow: auto;
	}

	.dashboard > header h1 {
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

	.actions .domain {
		display: flex;
		align-items: center;
	}

	.import {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 8px;
		font-size: 13px;
		color: var(--ink-soft);
	}

	.import input {
		min-width: 0;
	}

	.error {
		padding: 10px;
		border: 2px solid var(--stamp-red);
		border-radius: 2px;
		background: var(--sheet);
		color: var(--stamp-red);
	}

	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.project-list li {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px 12px;
		padding: 10px 12px 10px 18px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		box-shadow: var(--shadow-sheet);
	}

	.project-list li::before {
		content: '';
		position: absolute;
		left: 7px;
		top: 9px;
		bottom: 9px;
		width: 4px;
		border-radius: 2px;
		background: var(--highlight);
	}

	.project-list .name {
		font-family: var(--font-head);
		font-size: 16px;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--ink);
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
	}

	.tag {
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

	.tag.domain[data-domain='analog'] {
		color: var(--biro);
		border-color: var(--biro);
	}

	.tag.domain[data-domain='logic'] {
		color: var(--ink);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	@media (max-width: 560px) {
		.actions {
			flex-direction: column;
			align-items: stretch;
		}

		.actions form {
			flex-direction: column;
			align-items: stretch;
		}

		.import {
			flex-wrap: wrap;
			width: 100%;
		}
	}
</style>
