<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Canvas from '../../../../lib/components/editor/Canvas.svelte';
	import Inspector from '../../../../lib/components/editor/Inspector.svelte';
	import LockBanner from '../../../../lib/components/editor/LockBanner.svelte';
	import Palette from '../../../../lib/components/editor/Palette.svelte';
	import ShareDialog from '../../../../lib/components/editor/ShareDialog.svelte';
	import SimulationPanel from '../../../../lib/components/sim/SimulationPanel.svelte';
	import AnalysisPanel from '../../../../lib/components/sim/analog/AnalysisPanel.svelte';
	import { login } from '../../../../lib/api/auth';
	import { ApiError, apiErrorMessage, authErrorMessage } from '../../../../lib/api/client';
	import { MODEL_FORMAT_VERSION, parseModelSource } from '../../../../lib/engine/analog/parser';
	import {
		acquireLock,
		getLockState,
		heartbeatLock,
		isLockBusy,
		isLockConflict,
		lockStateFromError,
		releaseLock,
		type LockState
	} from '../../../../lib/api/locks';
	import {
		createProject,
		downloadDocument,
		getProject,
		localExportEnvelope,
		rememberProjectDomain,
		saveProject,
		toProjectDocument,
		validateProjectDocument,
		type ProjectDocument
	} from '../../../../lib/api/projects';
	import { RealtimeClient, type RealtimeMessage, type RealtimeStatus } from '../../../../lib/realtime/client';
	import {
		initialProjectRealtimeState,
		reduceProjectEvent,
		type ProjectRealtimeEvent,
		type ProjectRealtimeState
	} from '../../../../lib/realtime/stores';
	import { CircuitEditorStore } from '../../../../lib/state/circuitStore';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type LockRole = 'acquiring' | 'holder' | 'waiting' | 'lost' | 'free';

	// The editor owns its document for the lifetime of the page; a direct
	// param-to-param navigation is not exposed by the UI (dashboard remounts it).
	const projectId = untrack(() => data.project.id);
	const validation = untrack(() => validateProjectDocument(data.project.document));

	const store = validation.ok
		? new CircuitEditorStore({
				circuit: validation.document.circuit,
				definitions: validation.document.definitions,
				layouts: validation.document.layouts
			})
		: null;

	if (validation.ok) {
		rememberProjectDomain(projectId, validation.document.circuit.domain ?? 'logic');
	}

	let snapshot = $state(store ? store.snapshot : null);
	let name = $state(untrack(() => data.project.name));
	let version = $state(untrack(() => data.project.version));
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveError = $state<string | null>(null);
	let conflict = $state<{ latestVersion: number } | null>(null);
	let latestSummary = $state<string | null>(null);
	let reauth = $state(false);
	let reauthEmail = $state(untrack(() => data.user?.email ?? ''));
	let reauthPassword = $state('');
	let reauthError = $state<string | null>(null);
	let reauthBusy = $state(false);
	let copyBusy = $state(false);

	const lockKey = `circuitgate:lock:${projectId}`;
	let lockRole = $state<LockRole>('acquiring');
	let lockEpoch = $state(0);
	let holderEmail = $state<string | null>(null);
	let lockBusy = $state(false);
	let lockConflictReason = $state<string | null>(null);
	let shareOpen = $state(false);
	let realtimeStatus = $state<RealtimeStatus>('connecting');
	let projectDeleted = $state(false);
	let realtimeState = $state<ProjectRealtimeState>(initialProjectRealtimeState(untrack(() => data.project.version)));

	const readOnly = $derived(lockRole !== 'holder');

	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let realtime: RealtimeClient | null = null;

	$effect(() => {
		if (!store) return;
		snapshot = store.snapshot;
		return store.subscribe(() => {
			snapshot = store.snapshot;
		});
	});

	onMount(() => {
		void initialiseLock();
		startRealtime();
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			stopHeartbeat();
			realtime?.disconnect();
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
		};
	});

	function currentDocument(): ProjectDocument | null {
		if (!snapshot) return null;
		// structuredClone inside toProjectDocument cannot clone Svelte's
		// reactive proxies, so unwrap the snapshot before exporting/saving.
		return toProjectDocument(
			$state.snapshot({
				circuit: snapshot.circuit,
				definitions: snapshot.definitions,
				layouts: snapshot.layouts
			}) as ProjectDocument
		);
	}

	function countComponents(document: unknown): number {
		const result = validateProjectDocument(document);
		return result.ok ? result.document.circuit.components.length : 0;
	}

	function applyDocument(document: unknown): boolean {
		const result = validateProjectDocument(document);
		if (!result.ok || !store) return false;
		store.loadDocument({
			circuit: result.document.circuit,
			definitions: result.document.definitions,
			layouts: result.document.layouts
		});
		rememberProjectDomain(projectId, result.document.circuit.domain ?? 'logic');
		return true;
	}

	async function initialiseLock() {
		lockBusy = true;
		try {
			const stored = Number(sessionStorage.getItem(lockKey) ?? '');
			if (Number.isInteger(stored) && stored > 0) {
				try {
					const state = await heartbeatLock(projectId, stored);
					holdLock(state);
					return;
				} catch {
					sessionStorage.removeItem(lockKey);
				}
			}
			await attemptAcquire({ announceFailure: false });
		} finally {
			lockBusy = false;
		}
	}

	async function attemptAcquire(options: { announceFailure?: boolean } = {}): Promise<boolean> {
		const announceFailure = options.announceFailure ?? false;
		lockBusy = true;
		try {
			const state = await acquireLock(projectId);
			holdLock(state);
			lockConflictReason = null;
			return true;
		} catch (error) {
			if (isLockBusy(error)) {
				const lock = lockStateFromError(error);
				holderEmail = lock?.holderEmail ?? null;
				if (lock && typeof lock.epoch === 'number') {
					lockEpoch = Math.max(lockEpoch, lock.epoch);
				}
				lockRole = lockConflictReason ? 'lost' : 'waiting';
				return false;
			}
			lockRole = lockConflictReason ? 'lost' : 'free';
			if (announceFailure) {
				saveError = 'Could not request the edit lock. Try again.';
			}
			return false;
		} finally {
			lockBusy = false;
		}
	}

	function holdLock(state: LockState) {
		lockEpoch = state.epoch;
		holderEmail = data.user?.email ?? null;
		lockRole = 'holder';
		sessionStorage.setItem(lockKey, String(state.epoch));
		startHeartbeat(state.heartbeatSeconds);
	}

	function startHeartbeat(seconds: number) {
		stopHeartbeat();
		const interval = Math.max(5, seconds) * 1000;
		heartbeatTimer = setInterval(() => {
			void beat();
		}, interval);
	}

	function stopHeartbeat() {
		if (heartbeatTimer !== null) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
	}

	async function beat() {
		if (lockRole !== 'holder' || lockEpoch === 0) return;
		try {
			await heartbeatLock(projectId, lockEpoch);
		} catch (error) {
			if (isLockConflict(error)) {
				loseLock('expired');
			}
		}
	}

	function loseLock(reason: string) {
		stopHeartbeat();
		sessionStorage.removeItem(lockKey);
		holderEmail = null;
		lockRole = 'lost';
		lockConflictReason = reason;
	}

	async function releaseLockNow() {
		lockBusy = true;
		try {
			if (lockEpoch > 0) {
				await releaseLock(projectId, lockEpoch).catch(() => undefined);
			}
		} finally {
			stopHeartbeat();
			sessionStorage.removeItem(lockKey);
			lockEpoch = 0;
			holderEmail = null;
			lockRole = 'free';
			lockBusy = false;
		}
	}

	function onFocus() {
		if (document.visibilityState === 'hidden') return;
		if (lockRole === 'holder') {
			void beat();
		} else {
			void refreshLockState();
		}
	}

	function onVisibility() {
		if (document.visibilityState === 'visible') {
			onFocus();
		}
	}

	function onPageHide() {
		if (lockRole === 'holder' && lockEpoch > 0) {
			void releaseLock(projectId, lockEpoch, { keepalive: true }).catch(() => undefined);
		}
	}

	function startRealtime() {
		realtime = new RealtimeClient({
			onStatus: (status) => {
				realtimeStatus = status;
			},
			onResync: () => {
				void refetchAuthoritativeState();
			},
			onMessage: handleRealtimeMessage
		});
		realtime.subscribe(`/topic/projects/${projectId}`);
		realtime.connect();
	}

	function handleRealtimeMessage(message: RealtimeMessage) {
		const event: ProjectRealtimeEvent = message.event;
		const next = reduceProjectEvent(realtimeState, event);
		if (!next) return;
		realtimeState = next;

		if (event.type === 'project_deleted') {
			projectDeleted = true;
			return;
		}
		if (event.type === 'lock_changed') {
			const locked = event.locked === true;
			const epoch = typeof event.epoch === 'number' ? event.epoch : 0;
			if (locked) {
				holderEmail = typeof event.holderEmail === 'string' ? event.holderEmail : null;
				if (lockRole === 'holder') {
					if (event.holderId !== data.user?.id || epoch > lockEpoch) {
						loseLock('reassigned');
					}
				} else {
					lockRole = lockConflictReason ? 'lost' : 'waiting';
				}
			} else {
				holderEmail = null;
				if (lockRole !== 'holder') {
					void upgradeToHolder();
				}
			}
		}
	}

	async function upgradeToHolder() {
		if (lockBusy) return;
		const wasWaiting = lockRole === 'waiting';
		const acquired = await attemptAcquire();
		if (!acquired) {
			if (lockConflictReason) lockRole = 'lost';
			return;
		}
		try {
			const latest = await getProject(projectId);
			if (latest.version > version) {
				if (wasWaiting && !lockConflictReason) {
					if (applyDocument(latest.document)) {
						version = latest.version;
					}
				} else {
					conflict = { latestVersion: latest.version };
				}
			} else {
				version = latest.version;
			}
		} catch {
			// advisory; the next save surfaces any conflict
		}
	}

	async function refreshLockState() {
		if (lockBusy || lockRole === 'holder') return;
		try {
			const state = await getLockState(projectId);
			if (state.locked) {
				holderEmail = state.holderEmail;
				lockRole = lockConflictReason ? 'lost' : 'waiting';
				lockEpoch = Math.max(lockEpoch, state.epoch);
			} else {
				await upgradeToHolder();
			}
		} catch {
			// advisory
		}
	}

	async function refetchAuthoritativeState() {
		try {
			const latest = await getProject(projectId);
			if (latest.version > version) {
				const mayReplace = lockRole === 'waiting' || lockRole === 'free' || lockRole === 'acquiring';
				if (mayReplace) {
					if (applyDocument(latest.document)) {
						version = latest.version;
					}
				} else {
					conflict = { latestVersion: latest.version };
				}
			} else {
				version = latest.version;
			}
		} catch {
			// advisory; individual actions surface their own errors
		}
		await refreshLockState();
	}

	async function save() {
		if (readOnly) return;
		const document = currentDocument();
		if (!document) return;
		saveState = 'saving';
		saveError = null;
		conflict = null;
		latestSummary = null;
		try {
			const updated = await saveProject(
				projectId,
				name.trim() || data.project.name,
				version,
				document,
				lockEpoch > 0 ? lockEpoch : null
			);
			version = updated.version;
			name = updated.name;
			saveState = 'saved';
		} catch (cause) {
			saveState = 'idle';
			if (cause instanceof ApiError && cause.status === 401) {
				reauth = true;
				return;
			}
			if (isLockConflict(cause)) {
				const reason = typeof cause.body['reason'] === 'string' ? cause.body['reason'] : 'lock_lost';
				const latest = typeof cause.body['version'] === 'number' ? cause.body['version'] : null;
				if (latest !== null && latest > version) {
					version = latest;
				}
				loseLock(reason);
				return;
			}
			if (cause instanceof ApiError && cause.status === 409) {
				const latest = typeof cause.body.version === 'number' ? cause.body.version : version;
				conflict = { latestVersion: latest };
				return;
			}
			saveError = apiErrorMessage(cause);
		}
	}

	async function submitReauth(event: SubmitEvent) {
		event.preventDefault();
		reauthError = null;
		if (reauthEmail.trim().length === 0 || reauthPassword.length === 0) {
			reauthError = 'Enter your email and password.';
			return;
		}
		reauthBusy = true;
		try {
			await login(reauthEmail.trim(), reauthPassword);
			reauthPassword = '';
			reauth = false;
			await initialiseLock();
			await save();
		} catch (cause) {
			reauthError = authErrorMessage(cause);
		} finally {
			reauthBusy = false;
		}
	}

	async function viewLatest() {
		latestSummary = null;
		try {
			const latest = await getProject(projectId);
			latestSummary = `Latest is version ${latest.version} with ${countComponents(latest.document)} components.`;
		} catch (cause) {
			latestSummary = apiErrorMessage(cause);
		}
	}

	async function saveAsCopy() {
		const document = currentDocument();
		if (!document) return;
		copyBusy = true;
		saveError = null;
		try {
			const copy = await createProject(`${name.trim() || data.project.name} (copy)`, document);
			// A client-side goto to another project id would reuse this page
			// component without re-running its untracked initialization, so the
			// editor would keep the old project's store and lock while the URL
			// showed the copy. Force a fresh load of the copy instead.
			window.location.assign(`/projects/${copy.id}`);
		} catch (cause) {
			saveError = apiErrorMessage(cause);
		} finally {
			copyBusy = false;
		}
	}

	function exportLocal() {
		const document = currentDocument();
		if (!document) return;
		downloadDocument(localExportEnvelope(name.trim() || data.project.name, version, document));
	}

	// ---- model import -------------------------------------------------------

	let importOpen = $state(false);
	let importText = $state('');
	let importError = $state<string | null>(null);
	let importSuccess = $state<string | null>(null);

	function openImport() {
		if (readOnly) return;
		importOpen = true;
		importError = null;
		importSuccess = null;
	}

	function closeImport() {
		importOpen = false;
	}

	async function loadImportFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importError = null;
		importSuccess = null;
		try {
			importText = await file.text();
		} catch {
			importError = 'Could not read that file.';
		}
	}

	function submitImport() {
		if (readOnly || !store) return;
		importError = null;
		importSuccess = null;
		const parsed = parseModelSource(null, importText);
		if (!parsed.ok) {
			importError = parsed.message;
			return;
		}
		const result = store.addModel({
			name: parsed.model.name,
			formatVersion: MODEL_FORMAT_VERSION,
			source: importText
		});
		if (!result.ok) {
			importError = result.error;
			return;
		}
		importSuccess = `Imported model ${result.value.name}`;
		importText = '';
	}
</script>

<svelte:head>
	<title>{name} · CircuitGate</title>
</svelte:head>

{#if !validation.ok || !store || !snapshot}
	<div class="invalid">
		<h1>Unsupported project document</h1>
		<p>This project could not be opened because its document failed validation.</p>
		<ul>
			{#each validation.ok ? [] : validation.errors as issue (issue)}
				<li>{issue}</li>
			{/each}
		</ul>
		<p><a href="/projects">Back to projects</a></p>
	</div>
{:else}
	<div class="page">
		<header class="toolbar">
			<nav class="crumbs">
				<button type="button" onclick={() => store.navigateTo(0)}>root</button>
				{#each snapshot.path as crumb, index (crumb + index)}
					<span class="sep">/</span>
					<button type="button" onclick={() => store.navigateTo(index + 1)}>{crumb}</button>
				{/each}
			</nav>
			<label class="project-name">
				<span class="visually-hidden">Project name</span>
				<input bind:value={name} aria-label="Project name" disabled={readOnly} />
			</label>
			<span class="muted" data-testid="component-count">
				{snapshot.document.components.length} components
			</span>
			<span class="muted">version {version}</span>
			<span class="muted" data-testid="realtime-status" data-status={realtimeStatus}>
				{realtimeStatus === 'connected' ? 'live' : realtimeStatus}
			</span>
			<span class="spacer"></span>
			{#if data.project.owned}
				<button type="button" data-testid="share-project" onclick={() => (shareOpen = true)}>
					Share
				</button>
			{/if}
			{#if snapshot.domain === 'analog'}
				<button
					type="button"
					data-testid="import-model"
					onclick={openImport}
					disabled={readOnly}
				>
					Import model
				</button>
			{/if}
			<button
				type="button"
				data-testid="save-project"
				onclick={save}
				disabled={readOnly || saveState === 'saving'}
			>
				{saveState === 'saving' ? 'Saving…' : 'Save'}
			</button>
			<button type="button" data-testid="export-project" onclick={exportLocal}>Export</button>
			<a class="back" href="/projects">Projects</a>
			{#if saveState === 'saved' && !conflict}<span class="saved" data-testid="save-status">Saved</span>{/if}
			{#if saveError}<span class="error-inline" role="alert" data-testid="save-status">{saveError}</span>{/if}
		</header>

		<LockBanner
			role={lockRole}
			{holderEmail}
			busy={lockBusy}
			onAcquire={() => upgradeToHolder()}
			onRelease={releaseLockNow}
		/>

		{#if projectDeleted}
			<section class="conflict" role="alert" data-testid="deleted-panel">
				<p>This project was deleted. Your local copy is untouched; export it if you need it.</p>
				<button type="button" onclick={exportLocal}>Export local copy</button>
			</section>
		{/if}

		{#if lockConflictReason}
			<section class="conflict" role="alert" data-testid="lock-conflict-panel">
				<p>
					Your edit lock was lost ({lockConflictReason}). Your draft is kept locally — the project may have
					changed on the server.
				</p>
				<div class="conflict-actions">
					<button type="button" onclick={() => upgradeToHolder()} disabled={lockBusy}>
						{lockBusy ? 'Trying…' : 'Try to edit again'}
					</button>
					<button type="button" onclick={viewLatest}>View latest</button>
					<button type="button" onclick={saveAsCopy} disabled={copyBusy}>Save as copy</button>
					<button type="button" onclick={exportLocal}>Export local copy</button>
				</div>
				{#if latestSummary}<p class="muted" data-testid="latest-summary">{latestSummary}</p>{/if}
			</section>
		{/if}

		{#if conflict}
			<section class="conflict" role="alert" data-testid="conflict-panel">
				<p>
					This project changed on the server (version {conflict.latestVersion}). Your local copy is untouched —
					choose what to do next.
				</p>
				<div class="conflict-actions">
					<button type="button" onclick={viewLatest}>View latest</button>
					<a href={`/projects/${projectId}`} target="_blank" rel="noopener">Open latest in new tab</a>
					<button type="button" onclick={saveAsCopy} disabled={copyBusy}>
						{copyBusy ? 'Saving copy…' : 'Save as copy'}
					</button>
					<button type="button" onclick={exportLocal}>Export local copy</button>
				</div>
				{#if latestSummary}<p class="muted" data-testid="latest-summary">{latestSummary}</p>{/if}
			</section>
		{/if}

		{#if reauth}
			<section class="conflict" data-testid="reauth-panel">
				<p>Your session ended. Sign in again to finish saving — your document is kept locally.</p>
				<form onsubmit={submitReauth}>
					<label>
						<span>Email</span>
						<input type="email" bind:value={reauthEmail} autocomplete="email" />
					</label>
					<label>
						<span>Password</span>
						<input type="password" bind:value={reauthPassword} autocomplete="current-password" />
					</label>
					<button type="submit" disabled={reauthBusy}>
						{reauthBusy ? 'Signing in…' : 'Sign in and save'}
					</button>
					{#if reauthError}<span class="error-inline" role="alert">{reauthError}</span>{/if}
				</form>
			</section>
		{/if}

		<main class="editor">
			<Palette {store} readonly={readOnly} />
			<div class="canvas-area">
				<div class="canvas-slot">
					<Canvas {store} readonly={readOnly} />
				</div>
				{#key snapshot.domain}
					{#if snapshot.domain === 'analog'}
						<AnalysisPanel {store} readonly={readOnly} />
					{:else}
						<SimulationPanel {store} />
					{/if}
				{/key}
			</div>
			<Inspector {store} readonly={readOnly} />
		</main>

		<ShareDialog
			{projectId}
			projectName={name}
			open={shareOpen}
			onClose={() => (shareOpen = false)}
		/>

		{#if importOpen}
			<div
				class="import-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Import SPICE model"
				data-testid="import-model-dialog"
			>
				<h2>Import model</h2>
				<p class="muted">
					Paste a .model or .subckt definition, or choose a file. Imports are stored in the project
					document; .include and .lib are not supported.
				</p>
				<textarea
					data-testid="import-model-text"
					rows="10"
					bind:value={importText}
					placeholder=".model name type(...) or .subckt name ..."
				></textarea>
				<input
					type="file"
					data-testid="import-model-file"
					accept=".cir,.lib,.subckt,.model,.sp,.txt"
					onchange={loadImportFile}
				/>
				{#if importError}
					<p class="error-inline" role="alert" data-testid="import-model-error">{importError}</p>
				{/if}
				{#if importSuccess}
					<p class="saved" role="status" data-testid="import-model-success">{importSuccess}</p>
				{/if}
				<div class="import-actions">
					<button
						type="button"
						data-testid="import-model-submit"
						onclick={submitImport}
						disabled={readOnly || importText.trim().length === 0}
					>
						Import
					</button>
					<button type="button" data-testid="import-model-cancel" onclick={closeImport}>
						Close
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 7px 12px;
		background: var(--sheet);
		border-bottom: 2px solid var(--ink);
		flex-wrap: wrap;
	}

	.crumbs {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.crumbs button {
		font-size: 12px;
		padding: 3px 7px;
		border: 1px solid var(--rule);
		border-radius: 2px;
		background: var(--sheet-raised);
		cursor: pointer;
	}

	.sep {
		color: var(--ink-faint);
	}

	.project-name input {
		padding: 5px 8px;
		border: 1px solid var(--rule);
		border-radius: 2px;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		background: var(--sheet-raised);
	}

	.muted {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	.spacer {
		flex: 1;
	}

	.toolbar button {
		padding: 6px 10px;
	}

	.back {
		font-family: var(--font-head);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.saved {
		display: inline-block;
		font-family: var(--font-head);
		font-weight: 700;
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--stamp-green);
		border: 2px solid var(--stamp-green);
		border-radius: 3px;
		padding: 1px 6px;
		transform: rotate(-2deg);
	}

	.error-inline {
		font-size: 12px;
		color: var(--stamp-red);
	}

	.conflict {
		padding: 10px 12px;
		background: var(--sheet);
		border-bottom: 2px solid var(--ink);
		font-size: 13px;
		color: var(--ink);
	}

	.conflict p {
		margin: 0 0 8px;
	}

	.conflict-actions {
		display: flex;
		gap: 10px;
	}

	.conflict-actions button {
		padding: 5px 9px;
	}

	.conflict form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 10px;
	}

	.conflict form label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
	}

	.conflict form input {
		padding: 5px 8px;
		border: 1px solid var(--rule);
		border-radius: 2px;
		font-size: 13px;
	}

	.editor {
		flex: 1;
		display: flex;
		gap: 10px;
		padding: 10px;
		min-height: 0;
		overflow: auto;
	}

	.canvas-area {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.canvas-slot {
		flex: 1 1 auto;
		min-height: 420px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
		box-shadow: var(--shadow-sheet);
		overflow: hidden;
	}

	.invalid {
		padding: 24px;
		font-size: 14px;
		color: var(--ink);
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 2px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.import-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 20;
		width: min(560px, calc(100vw - 32px));
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--sheet);
		border: var(--rule-hair);
		border-radius: 3px;
		box-shadow: 0 12px 32px rgba(29, 29, 27, 0.28);
	}

	.import-modal h2 {
		font-size: 16px;
		margin: 0;
	}

	.import-modal textarea {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 8px;
		border: 1px solid var(--rule);
		border-radius: 2px;
		resize: vertical;
	}

	.import-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.import-actions button {
		padding: 6px 12px;
	}
</style>
