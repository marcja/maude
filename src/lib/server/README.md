# server

Server-only modules that handle database access, model communication, and request/response helpers. Every file in this directory imports `'server-only'`, which causes a build-time error if any client component transitively imports it -- enforced by the Next.js bundler.

## Files

| File | Purpose |
|------|---------|
| `db.ts` | SQLite access layer via `better-sqlite3`. Exposes a `createDatabase()` factory (tests use `:memory:`) and a singleton instance with all query functions |
| `modelAdapter.ts` | Thin wrapper over Ollama's OpenAI-compatible `/v1/chat/completions` endpoint. The ONLY file that reads `OLLAMA_BASE_URL`, `MODEL_NAME`, and `THINK_LEVEL` env vars |
| `promptBuilder.ts` | Constructs the system prompt from a base prompt plus user settings (name, personalization) |
| `apiHelpers.ts` | Shared `ValidationError` class and `jsonResponse()` utility used by all API route handlers |

## Architecture decisions

- **`server-only` boundary**: The `import 'server-only'` at the top of each file is a build-time guard, not a runtime check. If a client component (directly or transitively) imports any file from this directory, the Next.js build fails. This is a harder guarantee than convention or code review.
- **Model adapter as single env-var reader**: `modelAdapter.ts` is the only file that touches `OLLAMA_BASE_URL` or `MODEL_NAME`. Swapping model backends (Docker model runner, remote API) is a one-file change.
- **Thinking-tag detection NOT in the adapter**: The adapter yields raw token strings. `<think>`/`</think>` tag parsing is the BFF route's responsibility (`src/app/api/chat/route.ts`), keeping the adapter as a thin I/O wrapper.
- **Synchronous SQLite by design**: `better-sqlite3` is intentionally synchronous. In a single-user local app, synchronous I/O on a local file is faster than the async overhead of a remote database driver and eliminates a whole class of async bugs.
- **Factory pattern for testability**: `createDatabase(dbPath)` returns an isolated `DatabaseInstance`. Tests call it with `':memory:'` for per-test isolation without fragile `jest.resetModules()` patterns.

## Relationships

- **Depends on**: `src/lib/shared/types.ts` (domain types), `src/lib/server/migrations/001_initial.sql` (schema)
- **Depended on by**: All `src/app/api/` route handlers import from here. No client component may import from this directory.

## For new engineers

- **Modify first**: `db.ts` if adding a new data entity (add table to migration, add prepared statements and query functions). `modelAdapter.ts` if changing model configuration or switching backends.
- **Gotchas**:
  - Never import from this directory in any file under `src/components/`, `src/hooks/`, or `src/context/`. The build will fail.
  - `db.ts` uses `process.cwd()` instead of `__dirname` to locate the migration file because Next.js webpack rewrites `__dirname` to the `.next/` bundle output directory.
  - `modelAdapter.ts` wraps Ollama's `reasoning`/`reasoning_content` fields in `<think>`/`</think>` tags so the BFF's existing tag parser handles them transparently.
