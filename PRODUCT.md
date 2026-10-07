# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

University students doing digital and analog electronics coursework and personal projects — on lab, library, and personal machines, often under deadline, frequently in teams. The project owner is one of them. Hobbyist makers are the next audience; the interface should read as a general engineering tool, not a coursework-only toy.

## Product Purpose

CircuitGate is a browser circuit editor and simulator: draw logic or analog circuits, simulate them with trustworthy results, and verify a design before building it physically. Accounts, teams, project sharing, and edit locks exist so coursework and projects can be shared the way university work actually happens. Success means a student trusts a simulated result enough to build from it, and a classmate can open and run a shared project without instructions.

## Positioning

One owned, no-install tool that spans the logic-to-analog workflow students actually have, with real SPICE-class analog simulation and team sharing built in. Desktop tools (LTspice, TKGate) cannot offer browser access and shared projects; simple web simulators (Falstad) do not offer SPICE-class analog, curated real-device models, or coursework collaboration. The logic and analog domains live in one product with one project model, export format, and team workflow.

## Operating Context

Browsers at 1366x768 and larger, with connectivity required for accounts and storage. Coursework rhythms: build an ALU or CPU-scale logic design, verify an analog sensor front-end, share a project with a teammate, hand in an export. Local development runs PostgreSQL and Mailpit; production is a self-hosted Docker Compose stack behind TLS. Real usage includes lab machines where installing desktop software is not possible.

## Capabilities and Constraints

- Logic domain: schematic canvas, gates/flip-flops/mux/adders/ROM/RAM/register-file, subcircuits, delta-cycle and timed simulation, waveform viewer.
- Analog domain (shipping): SPICE-class ngspice WASM engine; `.op`, `.tran`, `.ac`, `.meas`; device library with curated in-house macromodels (741/TL072/555/393/7805 class); bounded SPICE `.model`/`.subckt` import; scope, Bode, operating-point, and measurement views.
- Mixed-signal co-simulation, PCB layout/fabrication, and real-parts/BOM are explicitly not in this product slice.
- Projects: versioned document, export/import `.circuitgate.json`, teams, sharing, single-editor locks, realtime state updates. Logic documents must remain valid and unchanged.
- Performance bar: sensor-front-end analog circuits simulate in seconds in the browser; logic stays interactive at ALU scale.
- Terminology is engineering vocabulary (net, node, bias point, transient); copy should stay terse and technical rather than friendly-marketing.
- Constraint: the frontend must remain lightweight (no UI framework or heavyweight component library), and existing end-to-end behavior (canvas manipulation, keyboard/mouse bindings) is load-bearing.

## Brand Commitments

None established. The product name "CircuitGate" is fixed. There is no logo, palette, or voice commitment recorded; even the favicon is still the framework default. A deliberate identity may be established.

## Evidence on Hand

A working product with visible logic and analog editors, dashboards, auth, teams, and account screens; comprehensive automated end-to-end suites. No marketing assets, testimonials, customer names, benchmarks, or press. Future work must not fabricate users, adoption, or performance claims.

## Product Principles

1. Trust over delight: every screen exists so a result can be believed before hardware is built.
2. Show the electronics: nets, values, and signals are the content; chrome recedes.
3. Density, not decoration: information-dense and fast beats spacious and pretty for this audience.
4. One product across domains: logic and analog share one shell, one project model, one vocabulary of interaction.
5. Finishable and maintainable: lightweight implementation, few dependencies, durable conventions.

## Accessibility & Inclusion

No product-specific requirement confirmed yet. Working baseline: WCAG AA contrast and focus behavior, full keyboard reachability of primary workflows, and reduced-motion respect.
