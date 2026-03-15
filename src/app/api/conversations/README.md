# api/conversations

CRUD endpoints for conversation management, consumed by the HistoryPane sidebar.

## Files

| File | Purpose |
|------|---------|
| `route.ts` | `GET /api/conversations` -- returns all conversations ordered by `updated_at` DESC |
| `[id]/route.ts` | `GET /api/conversations/:id` -- returns messages for a single conversation. `DELETE /api/conversations/:id` -- removes a conversation and its messages (CASCADE) |

## Architecture decisions

- **Dynamic route `[id]`**: Next.js App Router convention. The `[id]` directory creates a dynamic segment, and `route.ts` inside it receives the ID via `context.params`.
- **Async params**: Next.js App Router passes dynamic segment params as a `Promise` (not a plain object). Both handlers `await context.params` to extract the ID.
- **404 for missing conversations**: Both GET and DELETE verify the conversation exists before proceeding. Returning 404 for missing IDs prevents silent failures in the HistoryPane UI (e.g., clicking a stale conversation link).
- **CASCADE delete**: Deleting a conversation automatically deletes its messages via the `ON DELETE CASCADE` foreign key constraint in the SQLite schema. No separate message deletion needed.
- **Thin route handlers**: The handlers delegate all data access to `src/lib/server/db.ts` query functions. No business logic in the route files themselves.

## Relationships

- **Depends on**: `src/lib/server/db.ts` (getConversations, getConversation, getMessages, deleteConversation), `src/lib/server/apiHelpers.ts` (jsonResponse)
- **Depended on by**: `src/components/layout/HistoryPane.tsx` (fetches conversation list and detail), `src/components/chat/ChatShell.tsx` (fetches conversation on popstate)

## For new engineers

- **Modify first**: `[id]/route.ts` to add conversation update (e.g., rename). `route.ts` to add filtering or search to the list endpoint.
- **Gotchas**: The list endpoint returns conversations sorted by `updated_at DESC` -- this ordering is handled by the DB query in `db.ts`, not by the route handler.
