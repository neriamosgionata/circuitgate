---
title: Simulator symptoms that originate in the editor's domain boundaries
date: 2026-11-20
category: ui-bugs
module: frontend/editor
problem_type: ui_bug
component: frontend
symptoms:
  - "A logic switch showed an editable `open`/`closed` field that changed nothing when edited"
  - "A logic led offered the analog model picker, which selected a model the logic engine never reads"
  - "One output wired to two inputs drew repeated wires with a diagonal jump between consumer pins"
  - "A clock placed in the default delta-cycle mode read X immediately and reported an oscillation"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - simulation
  - editor
  - domain-boundary
  - clock
  - fan-out
---

# Simulator symptoms that originate in the editor's domain boundaries

## Problem

Three reports arrived as "the simulation is broken": a switch whose state control did nothing, wires
that looked reconnected several times, and a clock that produced X. Reproducing the first surfaced a
fourth symptom, a logic LED offering the analog model picker, from the same leak. None of them were
defects in the value algebra or the event engine: two came from the editor resolving data outside the
project's domain, one from the wire router joining pins that already share a net, and one from a
documented engine contract that the UI never explained. The lesson is the triage order, not the
individual fixes.

## Symptoms

- A logic `switch` was created carrying the analog parameter `state: "open"`, and the Inspector
  rendered it as a free-text box because enum options are analog-only. Editing it never changed the
  output, because `switchKind` reads `state.value`, not `state.state`.
- A logic `led` was created carrying `model: "ledred"`, and the Inspector offered the analog model
  picker for it.
- A net with one driver and two consumer pins was stroked as a single polyline that returned to the
  driver and then jumped straight to the next consumer pin, re-tracing the shared trunk once per
  consumer.
- A clock in the default delta-cycle mode produced `CLK = X` at t=0 with "oscillation detected on 1
  net", while the same clock toggled correctly in timed mode.

## What Didn't Work

- Reading `Simulator`, `settle()`, `resolveDrivers()`, and the gate truth tables first. All of them
  were correct: fan-out resolved properly, `0/1/X/Z` algebra checked out, and a toggle propagated to
  every consumer. The engine was the wrong place to look, and the passing engine tests said so.
- Assuming the switch toggle path was broken. `toggle` → `setState` → `settle` worked; the displayed
  string was a *parameter*, not the runtime value, so the control that looked broken was never wired
  to the simulation at all.
- Assuming the clock primitive was wrong. Its toggling was correct in timed and physical modes; the
  failure was `settle()` correctly refusing to reach a fixed point for a free-running source.

## Solution

Each cause was fixed at the layer that owned the invariant.

- Placement defaults are chosen per domain. `frontend/src/lib/state/circuitStore.ts:471` resolves
  analog defaults only when the project is analog, so a logic part never inherits a same-named
  analog parameter.
- The Inspector hides the parameters the other domain's kind of the same name declares, through
  `foreignParamNames(kind, domain)` in `frontend/src/lib/engine/kinds.ts`, which returns the analog-only
  names for a logic part and nothing for a real analog part. That helper keeps working for documents
  saved before the placement fix, which still carry the stale parameter, and the model fieldset is
  gated on the analog domain.
- `routeWire` in `frontend/src/lib/render/scene.ts:139` emits driver → branch → back to the driver, so
  every segment is axis-aligned and no segment connects two consumer pins.
- The clock resolves through `clockKindFor(polarity)` in
  `frontend/src/lib/engine/primitives/gates.ts:77`, giving `polarity` a real meaning as the level the
  clock presents before its first tick. The delta-cycle contract was left alone; when a clock exists
  in delta mode the simulation panel says delta has no time to advance it and points at the mode
  selector.

## Why This Works

`CircuitDocument` identifies parts by a `kind` string that both domains can share (`switch` and `led`
exist in both). Anything that resolves a kind, its pins, or its parameters must therefore carry the
domain, and the editor's defaults and Inspector are part of that boundary. The analog parameter was
inert because the logic engine never reads it — so no amount of simulation debugging could explain
the user-visible control.

For the clock, the defect was a mismatch between a documented contract (KTD4: delta-cycle settling
has no time; oscillation is marked X) and an interface that offered a clock without saying so. The
engine was left intact and the interface now explains the contract.

## Prevention

- Regression tests hold the behaviors: `frontend/src/lib/state/__tests__/editor.test.ts` (a logic
  `switch`/`led` is placed with no analog params, while an analog project keeps them),
  `frontend/src/lib/engine/__tests__/parameterized.test.ts` (`foreignParamNames` per domain),
  `frontend/src/lib/render/__tests__/scene.test.ts` (a fan-out net has only axis-aligned segments),
  and `frontend/src/lib/engine/__tests__/primitives.test.ts` (clock polarity as a starting level).
- They do not cover the Inspector wiring itself: nothing fails if `visibleParams` stops calling
  `foreignParamNames`, because the repo has no component-test harness for Svelte views.
- Triage rule: when a simulation symptom involves a part whose kind name exists in both domains,
  check what the editor stored on the component (`params`, `initialState`) before reading the
  simulator. A value the engine does not read cannot be a simulation bug.
- Triage rule: before changing `settle()` semantics, check whether the symptom is a clock or another
  self-scheduling source. Delta-cycle mode is defined to oscillate on those, by design.

## Related Issues

- `docs/plans/2026-11-19-1831-feat-physical-timing-mode-plan.md` records the delta/timed/physical
  contract and that clock polarity is not used in physical timing.
