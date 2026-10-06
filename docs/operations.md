# CircuitGate Operations

How to run, back up, and maintain the production deployment. The production
topology is `compose.prod.yaml`: PostgreSQL, the Spring Boot API, the SvelteKit
server, and a Caddy reverse proxy that terminates TLS on ports 80/443.

```text
Browser --TLS--> Caddy --+--> frontend:3000 (SvelteKit adapter-node)
                         +--> backend:8080  (Spring Boot API + /ws STOMP)
                                  |
                                  +--> db:5432 (PostgreSQL 17)
```

## Prerequisites

- A host with Docker Engine (or Podman with a Docker-compatible socket) and
  Compose v2.
- A DNS `A`/`AAAA` record for the public hostname pointing at the host, with
  ports 80 and 443 reachable so Caddy can complete the ACME challenge.
- An SMTP relay that accepts mail from the server (see
  [Mail deliverability](#mail-deliverability)).

## Configuration

Copy the template and edit every value marked `change-me`:

```sh
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `CIRCUITGATE_APP_BASE_URL` | Public origin, for example `https://circuitgate.example.edu`. Must match the browser origin exactly: it is used for cookies, the WebSocket origin allow-list, and verification/reset links. |
| `CIRCUITGATE_DOMAIN` | Hostname Caddy serves and requests certificates for. Usually the host part of `CIRCUITGATE_APP_BASE_URL`. |
| `CIRCUITGATE_DB_NAME` / `CIRCUITGATE_DB_USERNAME` / `CIRCUITGATE_DB_PASSWORD` | PostgreSQL database, user, and password. The `db` service creates them on first start. |
| `CIRCUITGATE_REMEMBER_ME_KEY` | Signs remember-me persistent tokens. Generate with `openssl rand -base64 48`. Changing it invalidates existing remember-me cookies. |
| `CIRCUITGATE_TRUSTED_PROXIES` | Comma-separated addresses/CIDRs allowed to set `X-Forwarded-For`. Defaults to the Compose bridge range `172.16.0.0/12`. |
| `CIRCUITGATE_MAIL_MODE` | `smtp` in production (the default here); `capture` keeps mail in memory for tests. |
| `CIRCUITGATE_MAIL_FROM` | Envelope/header sender for verification, reset, and duplicate-registration mail. |
| `SPRING_MAIL_HOST` / `SPRING_MAIL_PORT` / `SPRING_MAIL_USERNAME` / `SPRING_MAIL_PASSWORD` | SMTP relay connection. |
| `SPRING_MAIL_SMTP_AUTH` / `SPRING_MAIL_STARTTLS` | `true` for authenticated STARTTLS relays. |

Application defaults are baked into `application.yml`; override with the
`CIRCUITGATE_*` environment variables only when the defaults do not fit.

| Setting | Default | Notes |
|---|---|---|
| Session timeout | 7 days | Server-side sessions in PostgreSQL (`__Host-circuitgate-session`, `HttpOnly; Secure; SameSite=Lax`). `__Host-` requires HTTPS; local development uses the `local` profile with a non-prefixed, non-secure cookie. |
| Remember-me TTL | 14 days | Persistent login cookies, hashed at rest, rotated on use. |
| Lock TTL | 5 minutes | An editor lock expires without a heartbeat; the client heartbeats every `TTL / 3` (~100 s) and the server sweeps expired locks every 30 s. |
| Verification token TTL | 24 hours | Issued at registration and on resend; single use. |
| Password reset token TTL | 1 hour | Single use; a reset revokes sessions and remember-me tokens. |
| Token cleanup | Daily 03:30 | Expired/used verification and reset tokens are purged. |
| Throttling | 5 failures, exponential backoff capped at 15 min | Counters persist in PostgreSQL and recover automatically; cleanup daily 03:45. |
| Project document limits | 2 MB, depth 50, strings 10 000 chars, schema 1 | Enforced on save and import. |
| Realtime | STOMP `/ws`, in-memory broker | Single backend instance only. Scaling out requires an external broker, which is out of scope for v1. |

## Start, inspect, stop

```sh
docker compose -f compose.prod.yaml up -d --build     # build and start
docker compose -f compose.prod.yaml ps                # health status
docker compose -f compose.prod.yaml logs -f backend   # follow one service
docker compose -f compose.prod.yaml down              # stop (volumes kept)
docker compose -f compose.prod.yaml down -v           # stop and delete all data
```

Flyway runs the database migrations automatically when the backend starts; the
service is healthy only after migrations complete.

## Reverse proxy and TLS

Caddy reads `Caddyfile` (mounted read-only) and obtains/renews certificates
automatically once DNS resolves and ports 80/443 are reachable. It routes
`/api/*` and `/ws` to the backend and everything else to the frontend, adds
HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and
`X-Frame-Options: DENY`, and strips its own `Server` header.

- To use an ACME account contact, add a global `email you@example.edu` block at
  the top of `Caddyfile`.
- To serve behind another edge proxy or load balancer, keep ports 80/443
  published only to that proxy and add the proxy's address to
  `CIRCUITGATE_TRUSTED_PROXIES`.
- To test with a self-signed certificate, replace the site address with
  `localhost` plus `tls internal`; browsers will warn.

## Backup and restore

All durable state lives in the `pgdata` volume (accounts, sessions,
remember-me tokens, projects, teams, shares, locks) and in `caddy_data`
(certificates; regenerated automatically if lost).

Backup:

```sh
docker compose -f compose.prod.yaml exec -T db \
  pg_dump -U "${CIRCUITGATE_DB_USERNAME:-circuitgate}" \
          -d "${CIRCUITGATE_DB_NAME:-circuitgate}" \
          -Fc > "circuitgate-$(date +%Y%m%d-%H%M%S).dump"
```

Restore into a running database:

```sh
docker compose -f compose.prod.yaml stop caddy frontend backend
docker compose -f compose.prod.yaml exec -T db \
  pg_restore --clean --if-exists --no-owner \
  -U "${CIRCUITGATE_DB_USERNAME:-circuitgate}" \
  -d "${CIRCUITGATE_DB_NAME:-circuitgate}" < backup.dump
docker compose -f compose.prod.yaml start backend frontend caddy
```

Restore into a clean volume: `docker compose -f compose.prod.yaml down`,
remove the volume (`docker volume rm circuitgate_pgdata`), `up -d db`, then run
the `pg_restore` command above, then start the remaining services. Flyway
records schema history in the dump, so afterwards the backend starts without
re-running migrations it already applied.

Verify a restore by signing in and opening a project before deleting the
backup. Keep backups off the host; the dump is a complete snapshot of user
data.

## Mail deliverability

The app sends verification, password-reset, and duplicate-registration mail
through the configured SMTP relay. Sign-in is blocked until verification mail
is delivered, so treat mail as a critical dependency.

- Publish SPF, DKIM, and DMARC records for the sending domain; the plan defers
  hardening for a domain that does not exist yet, but the SMTP provider's
  documented records are required as soon as one does.
- Use a relay that allows the configured `CIRCUITGATE_MAIL_FROM` sender; a
  From/Return-Path mismatch (SPF align) causes spam filtering.
- If delivery fails, the API returns a retryable error and account state is
  preserved; check `docker compose -f compose.prod.yaml logs backend` for the
  failure and the relay's queue.
- Development uses Mailpit (`docker compose up -d mailpit`): SMTP on
  `localhost:1025`, web UI on <http://localhost:8025>.

## Upgrades

1. Back up the database (above).
2. `docker compose -f compose.prod.yaml build` and `up -d`.
3. Watch `docker compose -f compose.prod.yaml ps` until every service reports
   `healthy`; the backend applies additive Flyway migrations on startup.

The document schema is additive within schema version 1; a breaking schema
change ships with a migration before deploy.

## Analog engine asset

The analog simulation mode runs a vendored, license-clean ngspice compiled to
WebAssembly. The artifact lives in
`frontend/src/lib/engine/analog/ngspice/` (`ngspice.js`, `ngspice.wasm`,
`manifest.json`, `licenses/`, and the reproducible build inputs under
`build/`). Vite emits the wasm as a content-hashed asset under
`/_app/immutable/`; the app's CSP allows `'wasm-unsafe-eval'` in `script-src`
(never `'unsafe-eval'`).

### Provenance and license posture

- Source: ngspice `ngspice-47`, commit
  `a80f6e3e95d51534905b1f23410a951802666656` (BSD-3-Clause, `licenses/ngspice-COPYING.txt`).
- Toolchain: `docker.io/emscripten/emsdk:6.0.11`
  (digest `sha256:b4584bcb016b5416c2eb606e3aeffa7461a63037c0ba4cc8e83c6df3ffb532ba`).
- Copyleft modules excluded: KLU (`--disable-klu`), XSPICE and its GPL tables
  (`--disable-xspice`), OSDI (`--disable-osdi`), tclspice (no `--with-tcl`),
  and ADMS (not part of the build). CIDER is off by default.
- `numparam` (LGPL-2.1) is compiled in by upstream ngspice with no configure
  switch, so this build replaces `src/frontend/numparam/` with the MIT
  pass-through shim in `build/patches/numparam-shim/`. Parameter and brace
  expressions are evaluated by the TypeScript model front end before the deck
  reaches the engine (KTD6); an unresolved `.param` deck fails with an explicit
  "unknown subckt" diagnostic.
- HICUM2 (C++, fails to link under Emscripten; upstream ngspice bug #793) is
  removed, and an upstream `--disable-xspice` compile bug in
  `cktsopt.c` is patched, by the same build script.
- `manifest.json` records per-artifact SHA-256, byte sizes, build flags, and
  the forbidden-marker list. `frontend/scripts/check-analog-wasm.mjs` (run in
  CI) recomputes the hashes, enforces the payload budgets, and fails if any
  copyleft-module marker is present.

### Rebuilding

```sh
git clone --depth 1 --branch ngspice-47 \
  https://github.com/danchitnis/ngspice-sf-mirror ngspice-src
docker run --rm -v "$PWD:/work" -w /work emscripten/emsdk:6.0.11 \
  bash /work/frontend/src/lib/engine/analog/ngspice/build/build-ngspice-wasm.sh \
  /work/ngspice-src /work/out
# copy ngspice.js/ngspice.wasm into the vendor directory, recompute manifest
# hashes, then verify:
node frontend/scripts/check-analog-wasm.mjs
```

The build script prepends a `// @ts-nocheck` banner to the generated glue
(types for importers live in `ngspice.d.ts`). After any rebuild, update
`manifest.json` hashes and run the unit suite; `node:module` is externalized
with a warning in the browser build (dead Node-only branch in the Emscripten
glue) and is expected.

### Recorded measurements (reference machine, 2026-10-06)

| Measurement | Value |
|---|---|
| Raw payload (js + wasm) | 4,477,075 B (4.27 MiB), budget 40 MiB |
| Precompressed (brotli/gzip, min) | 1,016,732 B (0.97 MiB), budget 12 MiB |
| wasm compile, cold (Node) | ~9 ms |
| Instance create, cold/warm (Node) | ~1 ms |
| Divider `.op` run, warm (Node) | ~3 ms |
| Cold first run budget (e2e gate) | < 10 s; page reports fetch/instantiate/run |
| Node RSS delta after warm run | ~7.6 MB |
| Browser worker cold run (Playwright) | fetch 26 ms + instantiate 30 ms + run 16 ms (~72 ms), well under the 10 s budget |

The spike harness (`frontend/src/lib/engine/analog/__tests__/`) loads the
Node-compatible Emscripten build from disk because the vitest project is
Node-only; browser conditions (CSP, worker, hashed asset URL, immutable
caching, cancel) are proven by `frontend/tests/e2e/analog-engine-spike.spec.ts`
against the production build.

### Harness findings owned by later units

- The single-threaded build exposes no cooperative progress callback; U6
  should present progress as indeterminate.
- Cancellation is worker terminate-and-respawn (a synchronous solve cannot be
  cooperatively aborted). The e2e proves terminate is immediate and the next
  run completes inside the cold-run budget; U2 owns the real worker lifecycle,
  protocol, heap caps, and out-of-memory respawn.
- `frontend/src/lib/engine/analog/spike/worker.ts` and the `/analog-spike`
  route are the U1 browser proof harness; U2 replaces them with the versioned
  analog worker and the real UI.

## Troubleshooting

- **Backend unhealthy**: `logs backend`; the most common causes are database
  connectivity (`CIRCUITGATE_DB_*`) and a missing
  `CIRCUITGATE_REMEMBER_ME_KEY`.
- **Login works but pages immediately sign out**: the browser origin must
  equal `CIRCUITGATE_APP_BASE_URL`; `__Host-` cookies require HTTPS.
- **Realtime stays "connecting"**: verify `CIRCUITGATE_APP_BASE_URL` matches
  the browser origin exactly (scheme, host, and port), since the WebSocket
  handshake checks `Origin`.
- **Throttling misfires behind a proxy**: add the proxy's address/CIDR to
  `CIRCUITGATE_TRUSTED_PROXIES`; spoofed forwarded headers from untrusted
  sources are ignored by design.
