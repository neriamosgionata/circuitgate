# Analog result fixtures

Recorded solver-shaped results so the inspection views render without the
engine. `frontend/src/lib/sim/analog/fixture.ts` parses this shape; the e2e
harness assigns one to `globalThis.__circuitgateAnalogResultsFixture` before
the app boots and the analysis panel seeds its result area from it.

## Shape

```jsonc
{
  "shapeVersion": 1,                 // must be 1
  "lastCompletedKind": "tran",       // optional: op | tran | ac; picks the default tab
  "analyses": [
    {
      "id": "tran1",
      "kind": "tran",                // op | tran | ac
      "status": "complete",          // optional: complete | failed | suppressed (default complete)
      "stateLabel": "initial conditions", // optional
      "durationMs": 12.5,            // optional
      "diagnostic": { "code": "solver", "message": "..." }, // optional
      "variables": [
        { "name": "time", "type": "time", "real": [0, 1e-7] },
        { "name": "v(vout)", "type": "voltage", "real": [0, 0.1] },
        // complex variables carry both arrays:
        { "name": "v(out)", "type": "voltage", "real": [1, 0.7], "imag": [0, -0.7] }
      ]
    }
  ],
  "measurements": [
    {
      "analysisId": "meas1",         // optional, defaults to name
      "name": "vout-rms",
      "type": "rms",                 // power | rms | minmax
      "signal": "v(vout)",
      "status": "complete",          // optional: complete | failed
      "value": 0.55,                 // rms/power
      "min": -0.65, "max": 0.95,     // minmax
      "samples": 10001,
      "diagnostic": { "message": "..." } // optional
    }
  ]
}
```

`real` and `imag` accept JSON number arrays or `Float64Array` (the
procedural performance fixture builds typed arrays in page). Values on the
shared axis must be ascending; a transient axis is seconds, an AC axis is
hertz. Variables in one analysis share a length.

## Files

- `rc-clamp-tran.json` — 1 V -> -1 V square wave into an RC low-pass
  (tau = 100 us) with a diode clamp at -0.65 V, 10,001 points. Exercises the
  scope, peak preservation under decimation, and measurement rendering.
- `rc-lowpass-ac.json` — first-order RC sweep, 10 Hz to 1 MHz at 20 points
  per decade (corner 1591.55 Hz), for the Bode view.
