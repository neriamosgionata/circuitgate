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
	let query = $state('');
	let domainFilter = $state<'all' | Domain>('all');
	let nameInput: HTMLInputElement | undefined = $state();
	let fileInput: HTMLInputElement | undefined = $state();

	const counts = $derived.by(() => {
		const logic = projects.filter((project) => project.domain === 'logic').length;
		const analog = projects.filter((project) => project.domain === 'analog').length;
		return { all: projects.length, logic, analog };
	});

	const filtered = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return projects.filter((project) => {
			if (domainFilter !== 'all' && project.domain !== domainFilter) return false;
			if (needle.length === 0) return true;
			return project.name.toLowerCase().includes(needle);
		});
	});

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
			nameInput?.focus();
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

	function startIn(domain: Domain) {
		domainChoice = domain;
		nameInput?.focus();
		nameInput?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

	function relativeDate(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		const seconds = Math.round((Date.now() - date.getTime()) / 1000);
		if (seconds < 45) return 'just now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes} min ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
		const days = Math.round(hours / 24);
		if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>Projects · CircuitGate</title>
</svelte:head>

<div class="page-frame">
	<header class="page-head">
		<div>
			<h1>Projects</h1>
			<p class="lede">Every circuit is a sheet. Pick one back up, or pin a new one to the bench.</p>
		</div>
		<button type="button" class="primary" onclick={() => startIn(domainChoice)}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M8 3v10M3 8h10" />
			</svg>
			New project
		</button>
	</header>

	<div class="workspace">
		<section aria-labelledby="sheets-heading">
			<div class="list-toolbar">
				<div class="list-title">
					<h2 id="sheets-heading">Your sheets</h2>
					<span class="count" data-testid="project-count">
						{projects.length} {projects.length === 1 ? 'project' : 'projects'}
					</span>
				</div>

				{#if projects.length > 0}
					<div class="filters">
						<div class="segmented" role="group" aria-label="Filter by domain">
							<button type="button" class:active={domainFilter === 'all'} aria-pressed={domainFilter === 'all'} onclick={() => (domainFilter = 'all')}>
								All <span>{counts.all}</span>
							</button>
							<button type="button" class:active={domainFilter === 'logic'} aria-pressed={domainFilter === 'logic'} onclick={() => (domainFilter = 'logic')}>
								Logic <span>{counts.logic}</span>
							</button>
							<button type="button" class:active={domainFilter === 'analog'} aria-pressed={domainFilter === 'analog'} onclick={() => (domainFilter = 'analog')}>
								Analog <span>{counts.analog}</span>
							</button>
						</div>
						<label class="search">
							<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
								<circle cx="6.5" cy="6.5" r="4.2" />
								<path d="M9.8 9.8 14 14" />
							</svg>
							<span class="visually-hidden">Search projects</span>
							<input type="search" placeholder="Search projects" bind:value={query} />
						</label>
					</div>
				{/if}
			</div>

			{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

			{#if loading}
				<ul class="project-list skeleton-list" aria-hidden="true">
					{#each [0, 1, 2] as row (row)}
						<li class="project-item">
							<div class="project-row skeleton-row">
								<span class="skeleton flag"></span>
								<div class="row-main">
									<span class="skeleton title"></span>
									<span class="skeleton meta"></span>
								</div>
							</div>
						</li>
					{/each}
				</ul>
				<p class="visually-hidden" role="status">Loading projects…</p>
			{:else if loadError}
				<div class="error" role="alert">
					<p>{loadError}</p>
					<button type="button" onclick={load}>Retry</button>
				</div>
			{:else if projects.length === 0}
				<section class="empty-sheet">
					<svg class="empty-diagram" viewBox="0 0 260 88" aria-hidden="true" focusable="false">
						<path class="wire" d="M10 44h34" />
						<path class="gate" d="M44 28v32l26-16z" />
						<path class="wire" d="M70 44h30" />
						<circle class="node" cx="104" cy="44" r="4" />
						<path class="wire" d="M108 44h32" />
						<rect class="box" x="140" y="30" width="34" height="28" rx="2" />
						<path class="wire" d="M174 44h30" />
						<path class="wave" d="M204 44h8l6-16 8 32 8-32 8 32 8-16h8" />
						<text class="pin" x="6" y="60">IN</text>
						<text class="pin" x="238" y="60">OUT</text>
					</svg>
					<div class="empty-copy">
						<h2>No sheets on the bench yet</h2>
						<p>
							Start a blank project and place parts on the canvas, or import a
							<span class="mono">.circuitgate.json</span> file to pick up work from elsewhere.
						</p>
						<div class="empty-actions">
							<button type="button" class="primary" onclick={() => startIn('logic')}>
								Start a logic project
							</button>
							<button type="button" onclick={() => startIn('analog')}>Start an analog project</button>
						</div>
						<p class="empty-hint">Name it in the new project panel, then create.</p>
					</div>
				</section>
			{:else if filtered.length === 0}
				<p class="no-match">No sheets match “{query.trim() || domainFilter}”.</p>
			{:else}
				<ul class="project-list" data-testid="project-list">
					{#each filtered as project (project.id)}
						<li class="project-item">
							<a
								class="project-row"
								href={`/projects/${project.id}`}
								aria-label={`Open ${project.name}${project.domain ? `, ${project.domain}` : ''}`}
								data-testid="project-row"
								data-domain={project.domain ?? 'unknown'}
							>
								<span class="domain-flag" aria-hidden="true">
									{#if project.domain === 'analog'}
										<svg viewBox="0 0 24 24" focusable="false">
											<path d="M2 12c2.6-6 5.4-6 8 0s5.4 6 8 0 3.4-4 4-2.5" />
										</svg>
									{:else}
										<svg viewBox="0 0 24 24" focusable="false">
											<path d="M3 6v12h9l6-6-6-6z" />
											<path d="M12 12h9" />
										</svg>
									{/if}
								</span>

								<span class="row-main">
									<span class="row-top">
										<span class="name" data-testid="project-name">{project.name}</span>
										{#if project.domain}
											<span class="chip domain-{project.domain}" data-testid="project-domain" data-domain={project.domain}>
												{project.domain}
											</span>
										{/if}
										{#if project.owned === false}
											<span class="chip shared" data-testid="shared-tag">shared with you</span>
										{/if}
									</span>
								</span>

								<span class="titleblock row-tb">
									<span class="tb-cell">
										<span class="tb-label">Updated</span>
										<span class="tb-value" title={formatDate(project.updatedAt)}>{relativeDate(project.updatedAt)}</span>
									</span>
									<span class="tb-cell">
										<span class="tb-label">Revision</span>
										<span class="tb-value">v{project.version}</span>
									</span>
									<span class="tb-cell">
										<span class="tb-label">Domain</span>
										<span class="tb-value">{project.domain ?? 'logic'}</span>
									</span>
								</span>

								<span class="open-cue">
									Open
									<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
										<path d="M3 8h10M9 4l4 4-4 4" />
									</svg>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<aside class="side" aria-label="Project actions">
			<section class="sheet new-sheet">
				<div class="sheet-head">
					<h2>New project</h2>
				</div>
				<form onsubmit={create} class="sheet-body">
					<label class="field">
						<span>Project name</span>
						<input
							bind:this={nameInput}
							id="new-project-name"
							placeholder="New project name"
							bind:value={newName}
							autocomplete="off"
						/>
					</label>
					<label class="field">
						<span>Domain</span>
						<select bind:value={domainChoice} data-testid="new-project-domain" aria-label="Project domain">
							<option value="logic">Logic — gates, flip-flops, buses</option>
							<option value="analog">Analog — devices, bias, transient</option>
						</select>
					</label>
					<button type="submit" class="primary wide" data-testid="create-project" disabled={creating}>
						{creating ? 'Creating…' : 'Create project'}
					</button>
				</form>
				<div class="or"><span>or</span></div>
				<div class="sheet-body import-body">
					<input
						bind:this={fileInput}
						class="visually-hidden"
						type="file"
						accept="application/json,.json"
						data-testid="import-file"
						aria-label="Import project file"
						onchange={importFile}
						disabled={importing}
					/>
					<button type="button" class="wide" onclick={() => fileInput?.click()} disabled={importing}>
						{importing ? 'Importing…' : 'Import project file'}
					</button>
					<p class="hint">Reads a <span class="mono">.circuitgate.json</span> export.</p>
				</div>
			</section>

			<section class="sheet how-sheet" aria-labelledby="loop-heading">
				<div class="sheet-head">
					<h2 id="loop-heading">The working loop</h2>
				</div>
				<ol class="loop sheet-body">
					<li><strong>Place</strong> parts from the components panel.</li>
					<li><strong>Wire</strong> nets, then run the simulation.</li>
					<li><strong>Check</strong> the waveform or bias point.</li>
					<li><strong>Share</strong> with a team or export the file.</li>
				</ol>
			</section>
		</aside>
	</div>
</div>

<style>
	.page-head > div {
		min-width: 0;
	}

	.page-head button svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 24px;
		align-items: start;
	}

	.list-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 12px;
	}

	.list-title {
		display: flex;
		align-items: baseline;
		gap: 9px;
		min-width: 0;
	}

	.list-title h2 {
		margin: 0;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.count {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.filters {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.segmented {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		background: var(--paper-sunk);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
	}

	.segmented button {
		min-height: 26px;
		padding: 3px 9px;
		border: 0;
		border-radius: var(--radius-xs);
		background: transparent;
		color: var(--ink-soft);
		font-size: 12px;
		font-weight: 550;
		box-shadow: none;
	}

	.segmented button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.65);
		border-color: transparent;
	}

	.segmented button.active {
		background: var(--paper);
		color: var(--ink);
		box-shadow: var(--shadow-1);
	}

	.segmented button span {
		margin-left: 4px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--ink-faint);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		padding: 0 10px;
		background: var(--paper);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
	}

	.search:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.search svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: var(--ink-faint);
		stroke-width: 1.6;
		flex: none;
	}

	.search input {
		border: 0;
		background: transparent;
		min-height: 34px;
		width: 168px;
		padding: 0;
		box-shadow: none;
	}

	.search input:focus {
		box-shadow: none;
	}

	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.project-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
		text-decoration: none;
		color: var(--ink);
		transition:
			border-color 140ms linear,
			box-shadow 140ms linear,
			transform 140ms var(--ease-out);
	}

	.project-row:hover,
	.project-row:focus-visible {
		border-color: var(--accent-line);
		box-shadow: var(--shadow-lift);
		transform: translateY(-1px);
	}

	.project-row:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.domain-flag {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		flex: none;
		border-radius: var(--radius-sm);
		border: 1px solid var(--accent-line);
		background: var(--logic-soft);
		color: var(--logic);
	}

	.project-row[data-domain='analog'] .domain-flag {
		border-color: #ecc9a9;
		background: var(--analog-soft);
		color: var(--analog);
	}

	.project-row[data-domain='unknown'] .domain-flag {
		border-color: var(--rule);
		background: var(--paper-sunk);
		color: var(--ink-faint);
	}

	.domain-flag svg {
		width: 26px;
		height: 26px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.row-main {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}

	.row-top {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px 9px;
		min-width: 0;
	}

	.name {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.012em;
		color: var(--ink);
		overflow-wrap: anywhere;
		min-width: 0;
	}

	.project-row:hover .name {
		color: var(--accent-strong);
	}

	.row-tb {
		flex: 0 0 auto;
		box-shadow: none;
	}

	.row-tb .tb-cell {
		padding: 4px 10px 5px;
		background: var(--paper-soft);
	}

	.row-tb .tb-cell:nth-child(1) {
		min-width: 116px;
	}

	.row-tb .tb-cell:nth-child(2),
	.row-tb .tb-cell:nth-child(3) {
		min-width: 78px;
	}

	.row-tb .tb-cell:first-child {
		border-radius: var(--radius-xs) 0 0 var(--radius-xs);
	}

	.row-tb .tb-label {
		font-size: 8px;
	}

	.row-tb .tb-value {
		font-size: 11px;
	}

	.open-cue {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 6px 9px;
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		transition:
			color 140ms linear,
			background-color 140ms linear;
	}

	.open-cue svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
		transform: translateX(-3px);
		transition: transform 160ms var(--ease-out);
	}

	.project-row:hover .open-cue,
	.project-row:focus-visible .open-cue {
		background: var(--accent-soft);
		color: var(--accent-strong);
	}

	.project-row:hover .open-cue svg,
	.project-row:focus-visible .open-cue svg {
		transform: translateX(0);
	}

	.skeleton-row {
		pointer-events: none;
	}

	.skeleton.flag {
		width: 46px;
		height: 46px;
		flex: none;
		border-radius: var(--radius-sm);
	}

	.skeleton.title {
		width: min(260px, 60%);
		height: 16px;
		margin-bottom: 10px;
	}

	.skeleton.meta {
		width: min(220px, 45%);
		height: 22px;
	}

	.empty-sheet {
		display: grid;
		grid-template-columns: minmax(180px, 300px) minmax(0, 1fr);
		align-items: center;
		gap: clamp(20px, 4vw, 44px);
		padding: clamp(22px, 4vw, 40px);
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
	}

	.empty-diagram {
		width: 100%;
		height: auto;
	}

	.empty-diagram .wire {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.empty-diagram .gate {
		fill: var(--accent-soft);
		stroke: var(--accent);
		stroke-width: 1.7;
		stroke-linejoin: round;
	}

	.empty-diagram .box {
		fill: var(--paper);
		stroke: var(--ink);
		stroke-width: 1.7;
	}

	.empty-diagram .node {
		fill: var(--paper);
		stroke: var(--accent);
		stroke-width: 1.7;
	}

	.empty-diagram .wave {
		fill: none;
		stroke: var(--ok);
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	.empty-diagram .pin {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		fill: var(--ink-faint);
	}

	.empty-copy h2 {
		margin: 0 0 6px;
		font-size: 22px;
	}

	.empty-copy p {
		margin: 0 0 16px;
		max-width: 50ch;
		color: var(--ink-soft);
		font-size: 14px;
	}

	.empty-copy .mono {
		color: var(--ink);
		font-size: 12.5px;
		background: var(--paper-sunk);
		padding: 1px 5px;
		border-radius: var(--radius-xs);
	}

	.empty-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.empty-hint {
		margin: 12px 0 0;
		font-size: 12px;
		color: var(--ink-faint);
	}

	.no-match {
		margin: 0;
		padding: 22px;
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		color: var(--ink-soft);
		font-size: 14px;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.new-sheet form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.wide {
		width: 100%;
	}

	.or {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 14px;
		color: var(--ink-faint);
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.or::before,
	.or::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--rule);
	}

	.import-body {
		padding-top: 12px;
	}

	.hint {
		margin: 8px 0 0;
		font-size: 11.5px;
		color: var(--ink-faint);
	}

	.loop {
		margin: 0;
		padding: 12px 14px 12px 34px;
		font-size: 13px;
		color: var(--ink-soft);
	}

	.loop li {
		margin: 5px 0;
		padding-left: 2px;
	}

	.loop strong {
		color: var(--ink);
		font-weight: 600;
	}

	@media (max-width: 1040px) {
		.workspace {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			order: 2;
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			align-items: start;
		}
	}

	@media (max-width: 720px) {
		.project-row {
			flex-wrap: wrap;
		}

		.row-tb {
			flex: 1 1 100%;
			margin-top: 2px;
		}

		.open-cue {
			display: none;
		}

		.empty-sheet {
			grid-template-columns: minmax(0, 1fr);
		}

		.empty-diagram {
			max-width: 260px;
		}
	}

	@media (max-width: 560px) {
		.list-toolbar {
			align-items: flex-start;
			flex-direction: column;
		}

		.filters {
			width: 100%;
		}

		.segmented {
			width: 100%;
		}

		.segmented button {
			flex: 1;
		}

		.search {
			width: 100%;
		}

		.search input {
			width: 100%;
		}

		.project-row {
			align-items: flex-start;
			padding: 12px;
		}

		.domain-flag {
			width: 40px;
			height: 40px;
		}

		.row-tb .tb-cell {
			padding: 3px 8px 4px;
		}

		.empty-actions button {
			width: 100%;
		}

		.page-head > button {
			width: 100%;
		}
	}
</style>
