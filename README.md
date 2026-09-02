# Turnscope

Turnscope is a local-first proof of concept for development-agent observability. The first adapter imports local Codex rollout sessions read-only, preserves redacted source provenance, normalizes evidence into SQLite, and presents a local dashboard for usage, corrections, failures, and session drill-down.

This repository uses **agent observability** as the working product description. The POC does not make causal claims or treat diagnostic signals as automatic judgments.

## POC boundary

Included:

- Codex product discovery and a version-gated `0.152.x` rollout adapter
- Background, incremental JSONL import with live progress and stable source and event identities
- SQLite storage with cascade deletion, success/failure import audits, and gzipped redacted provenance
- Direct token/cache/error measurements, derived duration/cache ratio, and inferred correction taxonomy
- One explainable detector for repeated failing tool calls
- Electron desktop shell and a Vue session/pattern dashboard, with a bearer-protected Fastify fallback
- User overrides for detected or missed correction labels and diagnostic signals
- Sanitized fixtures with deterministic import, metric, API, deletion, and renderer tests

Deferred:

- Claude Code and other product adapters
- Packaged installers, signing, live interception, hosted ingestion, and synchronization
- Task/outcome inference, skill-effect experiments, billing integration, and causal conclusions
- Production-grade compatibility across arbitrary Codex rollout versions

## Architecture and ownership

```text
Codex rollout files (read-only)
        │
        ▼
Electron worker thread ──► src/adapters/codex.ts ──► src/importer.ts ──► src/db.ts (SQLite)
                                  │                 │
                                  ▼                 ▼
                           src/analytics.ts ◄── src/local-api.ts
                                                     │
                                      ┌──────────────┴──────────────┐
                                      ▼                             ▼
                              Electron typed IPC             Fastify HTTP API
                                      │                             │
                                      └──────────────┬──────────────┘
                                                     ▼
                                                web/src (Vue)
```

- `src/adapters/` owns source discovery and source-specific parsing.
- `src/importer.ts` owns normalization, stable identities, redaction, and import cursors.
- `src/db.ts` owns ordered schema migrations and the foreign-key/deletion lifecycle.
- `src/analytics.ts` owns metric definitions, inference heuristics, and evidence links.
- `src/local-api.ts` owns the renderer-facing local operations.
- `electron/` owns the desktop lifecycle, background import worker, and narrow typed IPC boundary.
- `src/server.ts` owns the optional HTTP transport and authentication boundary.
- `shared/contracts.ts` is the single source of truth for API DTOs.
- `web/src/` is a thin renderer and contains no import or metric logic.

The Electron renderer has no Node.js access and receives only the named Turnscope operations exposed by the preload bridge.

## Requirements

- Node.js 22.12 or newer
- pnpm 11.6.0
- A newest observed Codex session from `0.152.x` for validated usage parsing

## Setup and desktop development

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the Vue development server and opens Turnscope in Electron. Use **Import Codex sessions** on the Overview page to start or resume an incremental import. Progress and warnings remain visible while the importer runs in a worker thread, so navigation stays responsive. **Stop import** safely rolls back only the active file; a later resume skips completed files. It does not require a second API process, a browser URL, or a bearer token.

The CLI remains available for diagnostics and custom paths:

By default, Turnscope reads `${CODEX_HOME:-~/.codex}` and writes its database under the platform application-data directory. Override these locations without changing source data:

```sh
pnpm turnscope import --source-root /path/to/codex-home --database /path/to/turnscope.db
pnpm turnscope serve --database /path/to/turnscope.db
```

Delete one imported installation, including all normalized and provenance records, without deleting the Codex source:

```sh
pnpm turnscope delete --installation <installation-id> --database /path/to/turnscope.db
```

Build and run the production-like Electron output:

```sh
pnpm build
pnpm start
```

Packaged installers and signing remain deferred. The browser-based development fallback is still available in two terminals:

```sh
pnpm dev:api
```

```sh
pnpm dev:web
```

Open `http://127.0.0.1:5173/?token=turnscope-local-dev`.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

Tests never call model APIs and use only sanitized fixtures. A manual real-session check should copy one session into a temporary source root, import it into a temporary database, rerun the import to confirm it is skipped, inspect only aggregate counts, and delete the temporary source and database immediately.

## Measurement contract

- **Direct:** values reported by source records, including input, cached-input, and output tokens, timestamps, event counts, tool failures, model identifiers, and correction evidence events. Missing source values remain `null`.
- **Derived:** deterministic formulas. Cache ratio is `cached_input_tokens / input_tokens` when both are present and input is positive. Correction rate is agent-mistake corrections plus unproductive-steering turns, divided by all user turns; approvals, clarifications, new requirements, product decisions, preferences, and cancellations remain classified but are not counted as agent failures. Total session duration is the sum of each complete `ended_at - started_at` span; if any session lacks a complete span, the aggregate is missing. Percentiles use sorted inclusive linear interpolation at `(n - 1) × p`.
- **Inferred:** correction categories and detrimental-pattern signals. Each inference includes confidence, an explanation, and supporting event identifiers. The session drill-down lets the user edit detected corrections, add a missed correction to a user event, and dismiss or restore a diagnostic signal. Overrides are stored beside immutable source provenance and survive reimport.
- **Causal:** none. Skill and outcome comparisons are deferred until matched or controlled evaluation designs exist.

## Security and compatibility limits

Imported content is untrusted text. Turnscope does not execute raw source HTML. User and agent Markdown is rendered through an allowlisted renderer before the component uses `v-html`; images, embedded HTML, and non-HTTP links are rejected. All API endpoints except health require a bearer token, and known secrets are redacted before both normalized and provenance storage. Secret detection is best-effort and should not be treated as a complete data-loss-prevention system.

Codex rollout JSONL is undocumented local storage. The adapter emits a warning on every changed file and enables detailed usage parsing only for validated Codex `0.152.x` records. Unknown versions retain generic redacted provenance while usage remains explicitly missing. Cost and skill records remain missing unless a future source exposes explicit fields.

Discovery reads only the newest rollout metadata; it does not start Codex. Incrementality is file-level: unchanged files are skipped by metadata, while an appended file is reparsed and reconciled transactionally. Files removed from the source are intentionally retained as imported history until the user runs deletion, so external retention cleanup cannot silently erase analytics. Byte-offset append cursors remain follow-up hardening for larger stores.
