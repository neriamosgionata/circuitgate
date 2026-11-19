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

Open: mobile editing is scroll-dense once the palette, canvas, and analysis sheet stack; project domain tags rely on metadata remembered locally until a project is opened on the device.

## Direction contract

THESIS: The product as a live technical drafting sheet on a dark bench — a faint engineering grid, white sheets with title blocks, drafting-blue interaction, ochre analog identity, and mono values. It refuses both the dark-IDE editor panel look and the grey-plus-blue SaaS dashboard.

OWN-WORLD: ground #eef1f3 with a 32px grid, paper #ffffff / #f7f9fa / #edf1f3, ink #101820, dark rail #0f1923, accent #1858c9 (washes #e7effc), analog #a84a00, ok #0c7a4e, warn #8f5b00, danger #bf2b1f. Archivo for UI and display, JetBrains Mono for values, IDs and measurements. 4–6px radii, 1px rules, one small sheet shadow. Title blocks label real metadata; chips and stamps pair every color with text.

STORY: The student sees a drafting bench: their project as a sheet with a title block, parts in a components sheet, the circuit on a gridded canvas, results as measured traces. Everything important reads like a drawing annotation, so a teammate can pick it up without explanation.

FIRST VIEWPORT: Dark rail (brand, Projects/Teams/Account, account block) beside a page head and a title-blocked project sheet. The editor keeps the rail, a components sheet left, the gridded canvas center with a sheet title block, inspector right, and a simulation/analysis sheet docked below.

FORM: drafting-sheet system with title-block signature; position 7 of the grounded list; seed key 333ffe51.


FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
