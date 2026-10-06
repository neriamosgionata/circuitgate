# CircuitGate Analog Lab — Design Brief

## What we're building

Analog simulation as a first-class part of CircuitGate. You draw a real circuit on the same canvas you already use for logic, run proper SPICE-class analyses on it, and look at results you can trust before you ever pick up a breadboard. It lives inside the same projects, the same account, the same teams and sharing — an analog project is just another project.

## Why

Today a circuit gets checked one of two ways: breadboard it, or work through the math by hand. Both take time and parts before you know anything, and a wiring mistake shows up only after the board is built. CircuitGate already proved the better pattern for logic — simulate first, build second. This is the next step on the logic → analog → PCB path the first version set out, and the collaboration model that teams need is already in place.

The first real use case is sensor front-ends: conditioning, amplifying, and filtering real signals from multiple sensors. That is what gets built first, and it is how we will judge whether the thing works.

## What it must do

**Design.** Real components on the existing canvas: sources, resistors, capacitors, inductors, switches, pots, diodes, transistors, ideal op-amps, plus curated models of familiar parts (741/TL072-class op-amps, comparators, 555, regulators). Circuits declare a ground, every value is editable, and vendor device models can be imported as `.model`/`.subckt` files.

**Simulate.** The full set of analyses: DC operating point, transient, AC sweep, and measurements like power, RMS, and min/max. These are real runs with configurable parameters, not animated guessing, and the numbers must match hand calculations for linear circuits and datasheet behavior for nonlinear parts. When a circuit can't be solved, the tool says so clearly instead of showing made-up numbers.

**Inspect.** A scope-style viewer for transient traces, gain/phase plots for AC, operating-point voltages and currents readable right on the schematic, and the measurement results in plain sight.

**Share.** Analog projects save, lock, share, export, and import exactly like logic projects do, and existing logic projects keep working untouched.

## What we're not building yet

Mixed-signal simulation — analog and logic in one run — waits for the next slice. So do PCB layout and fabrication files, real parts and BOM, and LTspice-style netlist import. This slice is the analog lab and nothing past it.

## How we'll know it works

The test is simple: you stop breadboarding first drafts. A sensor front-end gets checked in the simulator, its bias point, waveform, and frequency response come out close to what you calculated, and you build with confidence. A teammate opens the shared project and runs it without being told how. And nothing about the existing logic simulator changes.

## Open items for the implementation plan

Which slice of the SPICE model format the importer accepts, how the solver is built, the exact analysis defaults and tolerance targets, and how an analog project is marked in the saved document — all of that is for the planning step, not settled here.

---

The full requirements, decisions, and acceptance examples live in `docs/plans/2026-10-06-1200-feat-circuitgate-analog-v1-plan.md`.
