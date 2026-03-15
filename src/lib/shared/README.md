# shared

Domain types shared between server and client code, providing a single source of truth that both sides of the `server-only` boundary can import.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Defines `Settings`, `ConversationSummary`, and `Message` interfaces used across the entire application |

## Architecture decisions

- **Separate shared directory**: The `server-only` guard on `src/lib/server/db.ts` causes a build-time error if any client component imports it. Types that both sides need (e.g., `Settings` for the settings form, `ConversationSummary` for the history pane) must live outside the server boundary. This directory is that neutral ground.
- **Domain types, not DB row types**: The interfaces mirror the SQLite schema but are named for their application role (`Message`, not `MessageRow`). Server code in `db.ts` re-exports these under legacy aliases (`UserSettings`, `ConversationRow`, `MessageRow`) for backward compatibility.
- **No runtime validation**: Types are compile-time only. Validation happens at API boundaries (`route.ts` files) using manual checks -- not here.

## Relationships

- **Depends on**: Nothing -- this is a leaf module with zero imports
- **Depended on by**: `src/lib/server/db.ts`, `src/lib/client/events.ts` (indirectly via the event schema), `src/components/chat/ChatShell.tsx`, `src/components/layout/HistoryPane.tsx`, `src/components/settings/SettingsForm.tsx`, `src/app/api/settings/route.ts`

## For new engineers

- **Modify first**: `types.ts` -- when adding a new domain entity (e.g., tags, attachments), define its interface here so both server and client code can use it
- **Gotchas**: Adding a field here does not automatically add it to the SQLite schema. You must also update `src/lib/server/migrations/` and the query functions in `src/lib/server/db.ts`
