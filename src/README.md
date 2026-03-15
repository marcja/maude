# src

Top-level source directory for the Maude application. Organized by responsibility with strict import rules across directories.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`app/`](app/README.md) | Next.js App Router: pages, layouts, API routes |
| [`components/`](components/README.md) | React client components organized by feature (chat, layout, settings) |
| [`hooks/`](hooks/README.md) | Custom React hooks for streaming, auto-scroll, stall detection, and observability |
| [`context/`](context/README.md) | React context providers (ObservabilityContext) |
| [`lib/`](lib/README.md) | Shared library code split into `client/`, `server/`, and `shared/` subdirectories |
| [`mocks/`](mocks/README.md) | MSW mock infrastructure for tests: handler factory, utilities, per-scenario handlers |

## Import rules

The most important architectural constraint in this codebase is the server-only boundary:

```
app/api/         --> lib/server/   OK (API routes run on the server)
app/api/         --> lib/client/   OK (imports SSEEvent type for serialization)
app/api/         --> lib/shared/   OK

app/chat/        --> lib/server/   OK (server component pages)
app/settings/    --> lib/server/   OK (server component pages)

components/      --> lib/client/   OK
components/      --> lib/shared/   OK
components/      --> lib/server/   BUILD ERROR (server-only guard)

hooks/           --> lib/client/   OK
hooks/           --> lib/server/   BUILD ERROR

mocks/           --> lib/client/   OK (imports SSEEvent type)
mocks/           --> lib/server/   BUILD ERROR
```

## Organization principle

Code is organized by **what it does**, not by technical role:

- **`lib/`** contains reusable logic with no React dependency (types, parsers, database, model adapter)
- **`hooks/`** contains React-specific state management logic
- **`context/`** contains React context providers for cross-cutting state
- **`components/`** contains React components organized by feature area
- **`app/`** contains the Next.js routing structure and API handlers
- **`mocks/`** contains test infrastructure that mirrors the API surface

## For new engineers

- **Start here**: Read `app/README.md` for the routing structure, then `components/chat/README.md` for the main UI, then `hooks/README.md` for the streaming lifecycle.
- **Gotchas**: The `server-only` boundary is enforced at build time, not runtime. If you see a `server-only` import error during `pnpm build` or `pnpm type-check`, it means a client component is (transitively) importing a server-only module.
