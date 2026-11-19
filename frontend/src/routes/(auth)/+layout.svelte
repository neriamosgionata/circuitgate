<script lang="ts">
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="auth-shell">
	<aside class="auth-art" aria-label="CircuitGate">
		<div class="art-top">
			<a class="brand" href="/">
				<svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
					<path d="M4 8h6l4 6h9" />
					<path d="M4 20h6l4-6" />
					<rect x="1" y="5" width="5" height="5" rx="1" />
					<rect x="1" y="17" width="5" height="5" rx="1" />
					<circle cx="23" cy="14" r="2.4" />
				</svg>
				<span>CircuitGate</span>
			</a>
			<p class="art-lede">
				Draw it. Simulate it.<br />
				Build it knowing it works.
			</p>
			<p class="art-sub">
				A browser bench for logic and analog circuits, with trustworthy results and projects
				your teammates can open.
			</p>
		</div>

		<figure class="art-figure" aria-hidden="true">
			<figcaption class="fig-caption">
				<span>FIG. 01</span>
				<span>Half-adder · transient</span>
			</figcaption>
			<svg class="schematic" viewBox="0 0 520 210" focusable="false">
				<g class="wire">
					<path d="M24 62h44" />
					<path d="M68 62v-18h26" />
					<path d="M68 62v18h26" />
					<path d="M24 148h44" />
					<path d="M68 148v-18h26" />
					<path d="M68 148v18h26" />
					<path d="M146 44h34" />
					<path d="M146 80h34" />
					<path d="M146 130h34" />
					<path d="M146 166h34" />
					<path d="M232 62h30v-10" />
					<path d="M232 148h30v10" />
					<path d="M262 52h48v26" />
					<path d="M262 158h48v-26" />
					<path d="M334 52v10" />
					<path d="M334 92v10" />
					<path d="M334 132v10" />
					<path d="M334 172v10" />
					<path d="M334 30h130" />
					<path d="M334 182h130" />
				</g>
				<g class="node">
					<circle cx="24" cy="62" r="3" />
					<circle cx="24" cy="148" r="3" />
					<circle cx="262" cy="30" r="3" />
					<circle cx="262" cy="182" r="3" />
				</g>
				<g class="gate">
					<path d="M94 26h30l22 18-22 18H94z" />
					<path d="M94 112h30l22 18-22 18H94z" />
					<path d="M94 26l14 9v18l-14 9" />
					<path d="M94 112l14 9v18l-14 9" />
				</g>
				<g class="wire accent">
					<path d="M180 62h32" />
					<path d="M180 148h32" />
					<path d="M212 62v86" />
					<path d="M212 105h20" />
				</g>
				<g class="gate accent">
					<path d="M232 92h30l22 13-22 13h-30z" />
				</g>
				<g class="labels">
					<text x="24" y="50">A</text>
					<text x="24" y="136">B</text>
					<text x="128" y="20">XOR</text>
					<text x="128" y="106">AND</text>
					<text x="302" y="47">Q</text>
					<text x="302" y="136">COUT</text>
				</g>
				<g class="trace">
					<path d="M334 182h20v-20h22v20h22v-20h22v20h22v-20h22v20h20" />
					<path class="trace-ghost" d="M334 182h20v-38h24v38h22v-38h22v38h22v-38h20" />
				</g>
				<g class="ticks">
					<path d="M354 196v6M398 196v6M442 196v6" />
				</g>
			</svg>
		</figure>

		<div class="art-foot">
			<span class="tb-label">Sheet</span>
			<span class="tb-value">CG-WEB / 01</span>
			<span class="tb-label">Bench</span>
			<span class="tb-value">logic + analog</span>
		</div>
	</aside>

	<main class="auth-panel">
		<a class="mobile-brand" href="/">
			<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
				<path d="M4 8h6l4 6h9M4 20h6l4-6" />
				<rect x="1" y="5" width="5" height="5" rx="1" />
				<rect x="1" y="17" width="5" height="5" rx="1" />
				<circle cx="23" cy="14" r="2.4" />
			</svg>
			<span>CircuitGate</span>
		</a>
		<div class="auth-card">
			{@render children()}
		</div>
		<p class="auth-legal">Browser circuit bench · logic + analog</p>
	</main>
</div>

<style>
	.auth-shell {
		display: grid;
		grid-template-columns: minmax(360px, 46%) minmax(0, 1fr);
		min-height: 100dvh;
	}

	.auth-art {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 24px;
		padding: clamp(28px, 4vw, 56px);
		background-color: var(--shell);
		background-image:
			linear-gradient(rgba(233, 239, 244, 0.055) 1px, transparent 1px),
			linear-gradient(90deg, rgba(233, 239, 244, 0.055) 1px, transparent 1px);
		background-size: 32px 32px;
		color: var(--shell-ink);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--shell-ink);
		text-decoration: none;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.brand-mark {
		width: 28px;
		height: 28px;
		fill: none;
		stroke: var(--shell-ink);
		stroke-width: 1.7;
	}

	.brand-mark circle {
		fill: #6ea8ff;
		stroke: #6ea8ff;
	}

	.brand:focus-visible {
		outline: 2px solid #cfe0ee;
		outline-offset: 3px;
	}

	.art-lede {
		margin: 22px 0 10px;
		font-size: clamp(26px, 3vw, 38px);
		line-height: 1.12;
		letter-spacing: -0.03em;
		font-weight: 650;
		color: #fff;
		max-width: 16ch;
	}

	.art-sub {
		margin: 0;
		max-width: 44ch;
		font-size: 14px;
		line-height: 1.55;
		color: #b9c8d4;
	}

	.art-figure {
		margin: 0;
		max-width: 560px;
		width: 100%;
	}

	.fig-caption {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--shell-line);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--shell-soft);
	}

	.schematic {
		display: block;
		width: 100%;
		height: auto;
		margin-top: 14px;
		overflow: visible;
	}

	.schematic .wire path {
		fill: none;
		stroke: #7d8f9d;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.schematic .wire.accent path {
		stroke: #6ea8ff;
	}

	.schematic .gate path {
		fill: rgba(255, 255, 255, 0.04);
		stroke: #dce6ee;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}

	.schematic .gate.accent path {
		stroke: #6ea8ff;
	}

	.schematic .node circle {
		fill: #101820;
		stroke: #6ea8ff;
		stroke-width: 1.6;
	}

	.schematic .labels text {
		fill: #9fb0bd;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		letter-spacing: 0.06em;
	}

	.schematic .trace path {
		fill: none;
		stroke: #6ea8ff;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	.schematic .trace .trace-ghost {
		stroke: #4c6a83;
		stroke-width: 1.2;
	}

	.schematic .ticks path {
		stroke: #52697b;
		stroke-width: 1.2;
	}

	.art-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 10px;
		padding-top: 12px;
		border-top: 1px solid var(--shell-line);
		font-size: 10px;
	}

	.art-foot .tb-label {
		color: #7d8f9d;
		font-family: var(--font-ui);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-weight: 650;
	}

	.art-foot .tb-value {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: #c7d3dc;
		margin-right: 14px;
	}

	.auth-panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		padding: clamp(24px, 5vw, 64px) clamp(18px, 4vw, 48px);
		background: var(--ground);
	}

	.mobile-brand {
		display: none;
		align-items: center;
		gap: 8px;
		color: var(--ink);
		text-decoration: none;
		font-weight: 700;
		font-size: 16px;
	}

	.mobile-brand svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.7;
	}

	.mobile-brand circle {
		fill: var(--accent);
		stroke: var(--accent);
	}

	.auth-card {
		width: min(440px, 100%);
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: clamp(24px, 3vw, 34px);
		background: var(--paper);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
	}

	.auth-legal {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	@media (max-width: 900px) {
		.auth-shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.auth-art {
			display: none;
		}

		.mobile-brand {
			display: inline-flex;
		}

		.auth-panel {
			min-height: 100dvh;
		}
	}
</style>
