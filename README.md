# CircuitGate

Browser-based logic circuit editor and simulator. SvelteKit frontend with a
delta-cycle simulator in a Web Worker, Spring Boot API, PostgreSQL.

## Repository layout

| Path | Description |
|---|---|
| `frontend/` | SvelteKit 3 / Svelte 5 / TypeScript app (Bun tooling) |
| `backend/` | Spring Boot 4.1 / Java 25 API (Maven wrapper) |
| `compose.yaml` | Development PostgreSQL 17 and Mailpit |
| `.github/workflows/ci.yml` | CI for both packages |

## Requirements

- Bun 1.4.3
- Java 25
- Docker or Podman with a Docker-compatible socket (for Compose and Testcontainers)
- Maven is not required; use `backend/mvnw`

## Local services

```sh
docker compose up -d db mailpit
```

PostgreSQL listens on `localhost:5432` (`circuitgate`/`circuitgate`), Mailpit
SMTP on `localhost:1025` and its web UI on <http://localhost:8025>.

## Commands

| Scope | Command |
|---|---|
| Frontend dev server | `cd frontend && bun run dev` |
| Frontend unit tests | `cd frontend && bun run test` |
| Frontend types and lint | `cd frontend && bun run check` |
| Frontend production build | `cd frontend && bun run build` |
| End-to-end tests | `cd frontend && bun run test:e2e` (requires Compose services, backend, and `bunx playwright install` once) |
| Backend build and tests | `cd backend && ./mvnw verify` |
| Local services | `docker compose up -d db mailpit` |
