---
version: 1
slug: "frontend-src-routes-app-projects-id-page-svelte"
primary_target: "frontend/src/routes/(app)/projects/[id]/+page.svelte"
related_targets: ["frontend/src/routes/(app)/+layout.svelte","frontend/src/routes/(auth)"]
---

# Surface brief — CircuitGate app shell + editor

Mode: operate. Audience: university students (then makers), under deadline, often in teams, on lab/library/personal machines.

Job: find a part, place and wire it, run an analysis, read the result — without hunting. Success: a newcomer completes that loop; a returning user moves between projects without friction; a teammate opens a shared sheet with no instructions.

Scope: app shell (nav, projects, teams, account, auth), editor chrome (toolbar, parts sheet, canvas presentation, inspector, status), simulation surfaces (analysis form, run controls, scope/Bode/OP/measurements). Untouched: canvas interaction mechanics and bindings, engines, document schema, test hooks, utilitarian density. Anti-goals: dark-IDE look, gamification, paper effects that cost legibility or speed, new UI dependencies.

Constraints: WCAG AA baseline, lightweight CSS, existing performance budget, `frontend/tests` selectors stay valid.

Open: projects board vs list treatment; mobile read-only vs editable; paper-material intensity.

## Direction contract

THESIS: The editor as a pinned departmental worktable — photocopied sheets, toner text, highlighter marks, rubber-stamp outcomes; it refuses the dark-IDE panel look and the grey-plus-blue SaaS dashboard.

OWN-WORLD: kraft-board shell (#c9b79a over #b9a482), copy-paper sheets (#e7e3d9), toner text (#1d1d1b), highlighter selection (#ffe23d wash), stamp red (#c0271b void/fail), bottle-green ink (#1f6b43 pass), biro blue (#1d4ed8 wires/links). Saira Condensed for sheet heads and stamped labels; Public Sans for prose; Courier Prime for codes, values, measurements (tabular). Hairlines #8a8377; sheets ruled by a 1px header band; buttons are stapled strips, chips are stamped labels.

STORY: The student sees a worktable: parts pinned, work taped down, whatever they touch highlights, whatever ran is stamped. Outcome readable at a glance, sheet handable to a teammate.

FIRST VIEWPORT: Board-rail header: project name in stamped capitals, actions as stapled strips. Three pinned sheets fill the viewport — numbered parts sheet left, taped graph-paper canvas center, spec slip right — analysis strip pinned below, run status as a stamp.

FORM: notice-board sheet system, position 7 of the grounded list; seed key 333ffe51.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
