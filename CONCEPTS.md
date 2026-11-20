# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound captures and refreshes learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Component

A placed part identified by an `id`, a `kind`, and a map from each of its pins to the net that pin sits on. A component's pinout is derived from its kind, and a kind that takes parameters can expose a different pinout per instance, so pin lists are never assumed from the kind name alone.

## Net

A named electrical connection shared by every pin that references it. A net with exactly one pin is dangling; a net with several consumer pins and one driver is ordinary fan-out. Connectivity is defined entirely by the net name a pin stores — two pins are connected when they name the same net, never because their wires happen to cross or touch on the canvas.

## Domain

Whether a project describes digital logic or analog electronics. A domain decides which kinds exist, how each kind's pins are laid out, and which parameters a component can carry. Kind names can exist in both domains with different meanings, so anything that resolves a kind, its pins, or its parameters has to know the domain it is resolving for.

## Simulation mode

How the logic simulator advances, and therefore what time means to a circuit.

- **Delta-cycle** settles to a fixed point with no notion of time. A free-running source such as a clock has no fixed point here, so it is expected to oscillate and be marked unknown rather than to advance.
- **Timed** advances one uniform unit-delay tick at a time; a clock toggles once per tick.
- **Physical timing** advances real time with per-part delays, so unequal paths produce glitches and near-edge captures produce timing violations.
