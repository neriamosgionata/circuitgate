# CircuitGate

Browser-based logic circuit editor and simulator. A SvelteKit client runs a
delta-cycle simulator in a Web Worker; a Spring Boot API with PostgreSQL
provides accounts, projects, teams, sharing, edit locks, and realtime state.

## Project structure

| Path | Description |
|---|---|
| `frontend/src/lib/model/` | Circuit document types and validation |
| `frontend/src/lib/engine/` | Pure TypeScript compiler, delta-cycle simulator, primitives, subcircuits, analog kinds and model library |
| `frontend/src/lib/render/` | Canvas scene, culling, hit testing, geometry |
| `frontend/src/lib/sim/` | Worker protocol, session, diagnostics, waveform recorder |
| `frontend/src/lib/state/` | Editor store and selection |
| `frontend/src/lib/api/` | REST client, CSRF handling, project export/import |
| `frontend/src/lib/realtime/` | STOMP client and stores |
| `frontend/src/routes/` | Auth pages, dashboard, project editor |
| `frontend/src/workers/` | Engine Web Worker entry point |
| `frontend/tests/e2e/` | Playwright specs (ALU, CPU, latch, oscillator, export round-trip, performance) |
| `frontend/tests/fixtures/` | Importable project fixtures used by the end-to-end suite |
| `backend/src/main/java/` | Account, project, team, sharing, lock, and realtime packages |
| `backend/src/main/resources/db/migration/` | Flyway migrations |
| `compose.yaml` | Development PostgreSQL and Mailpit |
| `compose.prod.yaml`, `Caddyfile` | Production stack and TLS reverse proxy |
| `docs/operations.md` | Deployment, environment, backup/restore, and mail notes |
| `docs/plans/` | Implementation plan |

## Requirements

- Bun 1.4.2+
- Java 25
- Docker or Podman with a Docker-compatible socket (for Compose and
  Testcontainers)
- Maven is not required; use `backend/mvnw`

## Commands

| Scope | Command |
|---|---|
| Local services | `docker compose up -d db mailpit` |
| Frontend dev server | `cd frontend && bun run dev` |
| Frontend unit tests | `cd frontend && bun run test` |
| Frontend types and lint | `cd frontend && bun run check` |
| Frontend production build | `cd frontend && bun run build` |
| End-to-end tests | `cd frontend && bun run test:e2e` |
| Backend build and tests | `cd backend && ./mvnw verify` |
| Production stack | `docker compose -f compose.prod.yaml up -d --build` |

## Local development

```sh
docker compose up -d db mailpit
```

PostgreSQL listens on `localhost:5432` (`circuitgate`/`circuitgate`); Mailpit
SMTP on `localhost:1025` and its web UI on <http://localhost:8025>.

Run the backend with the local profile and SMTP pointed at Mailpit, and the
frontend dev server (which proxies `/api` and `/ws` to the backend):

```sh
cd backend && CIRCUITGATE_MAIL_MODE=smtp SPRING_MAIL_HOST=localhost \
  SPRING_MAIL_PORT=1025 ./mvnw spring-boot:run -Dspring-boot.run.profiles=local
cd frontend && bun run dev
```

## Analog projects

A project's document may declare `"domain": "analog"`; absent means logic. The
editor then offers analog devices instead of digital primitives, resolved
through the shared kind resolver in `frontend/src/lib/engine/kinds.ts`:

- Sources with `dc`, `sine`, `pulse`, and `step` waveforms: `vsource`,
  `isource`.
- Passives: `resistor`, `capacitor`, `inductor`, `potentiometer`, and a
  two-state `switch`.
- Semiconductor devices: `diode`, `led`, `zener`, `bjt`, and `mosfet`, each
  selecting a curated model card.
- Amplifiers and ICs: an `idealOpamp`, plus model-backed `opamp`, `comparator`,
  `timer555`, and `regulator` kinds.
- `ground`, a single input pin that maps to SPICE node `0`.

Two-terminal devices expose `p1` (input) and `p2` (output) as an editor
affordance; pin direction is not a netlist constraint. Values accept
unambiguous SI suffixes (`10k`, `1meg`, `1m` is milli, bare `M` is rejected).
Model-backed devices list curated and project-imported models in the
inspector, with a diagnostic for missing or unresolved references.

Curated models live in `frontend/src/lib/engine/analog/models/` as in-house
macromodels and model cards under neutral in-house terms; every asset is
recorded in `manifest.json` with source, license, redistribution terms, and
SHA-256. No asset ships unless its manifest terms permit redistribution in the
application bundle. See `docs/plans/2026-10-06-1200-feat-circuitgate-analog-v1-plan.md`
for the full analog lab scope.

## End-to-end tests

Playwright drives a production build through `vite preview` (API and WebSocket
proxied to the backend). The suite needs the development database and mail
catcher, a backend on `:8080`, Chromium, and nothing else on the preview port:

```sh
docker compose up -d db mailpit
cd backend && CIRCUITGATE_MAIL_MODE=smtp SPRING_MAIL_HOST=localhost \
  SPRING_MAIL_PORT=1025 CIRCUITGATE_APP_BASE_URL=http://localhost:4173 \
  ./mvnw spring-boot:run -Dspring-boot.run.profiles=local   # terminal 1
cd frontend && bunx playwright install chromium              # once
cd frontend && bun run test:e2e                              # terminal 2
```

`PLAYWRIGHT_BASE_URL` overrides the preview origin; `MAILPIT_URL` overrides the
mail-catcher API used to read verification and reset links.

## Deployment

`compose.prod.yaml` builds the multi-stage Dockerfiles and runs PostgreSQL, the
backend, the frontend, and Caddy with automatic TLS. Copy `.env.example` to
`.env`, set the values, then:

```sh
docker compose -f compose.prod.yaml up -d --build
```

See `docs/operations.md` for environment variables, TLS, backups and restores,
lock/token retention, and mail deliverability.
