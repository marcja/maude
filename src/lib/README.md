# lib

Shared library code organized into three subdirectories with a strict import rule: **client code may import from `shared/` and `client/` but never from `server/`**. The `server-only` build guard enforces this at compile time.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`shared/`](shared/README.md) | Domain types (`Settings`, `Message`, `ConversationSummary`) importable by both server and client code |
| [`client/`](client/README.md) | Client-side SSE parser and event type definitions consumed by hooks and components |
| [`server/`](server/README.md) | Server-only modules: SQLite database, Ollama model adapter, prompt builder, API helpers |

## Architecture decisions

- **Three-way split enforces the server-only boundary**: The `server/` directory contains modules guarded by `import 'server-only'`. Types that both sides need live in `shared/`. Client-specific utilities (SSE parsing, event schema) live in `client/`. This structure makes the boundary visible in the file tree, not just in import guards.
- **No barrel files**: Each subdirectory is imported by path (`../lib/server/db`, `../lib/client/sseParser`), not through an `index.ts` re-export. This keeps dependency graphs explicit and avoids accidental transitive imports across the boundary.

## Import rule

```
src/components/  ──> src/lib/shared/  (OK)
src/components/  ──> src/lib/client/  (OK)
src/components/  ──> src/lib/server/  (BUILD ERROR)

src/app/api/     ──> src/lib/server/  (OK)
src/app/api/     ──> src/lib/shared/  (OK)
src/app/api/     ──> src/lib/client/  (OK, for SSEEvent type)
```

## Relationships

- **Depended on by**: Every module in the application imports from one or more `lib/` subdirectories
- **Depends on**: Nothing outside itself (leaf of the dependency tree)

## For new engineers

- **Modify first**: Depends on what you are building. New domain types go in `shared/types.ts`. New client-side parsing logic goes in `client/`. New server-side data access goes in `server/`.
- **Gotchas**: If you add a new file to `server/`, include `import 'server-only'` at the top. Without it, the file is not protected by the build guard and a client component could accidentally import it.
