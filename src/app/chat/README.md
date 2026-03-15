# chat

Chat page routes. Server components that pre-fetch data from SQLite and pass it as props to the `ChatShell` client component, eliminating client-side fetch waterfalls.

## Files

| File | Purpose |
|------|---------|
| `page.tsx` | `/chat` -- server component for new conversations. Reads the conversation list from SQLite and passes it as `initialConversations` to ChatShell |
| `[id]/page.tsx` | `/chat/:id` -- server component for existing conversations. Pre-fetches the conversation, its messages, and the conversation list. Returns 404 if the conversation doesn't exist |

## Architecture decisions

- **Server component pages, client component shell**: The page components are server components that run on the server, read SQLite synchronously, and pass data as props to `ChatShell`. This eliminates the loading flash that a client-side fetch would cause. All interactive logic lives in `ChatShell`.
- **Dynamic route for existing conversations**: `/chat/[id]` pre-fetches the specific conversation and its messages so that direct URLs (bookmarks, shared links, browser back/forward) render immediately with full content.
- **`notFound()` for missing conversations**: The `[id]` page calls Next.js's `notFound()` if `getConversation(id)` returns undefined, rendering the default 404 page.

## Relationships

- **Depends on**: `src/components/chat/ChatShell.tsx` (the client component that receives all props), `src/lib/server/db.ts` (reads conversations and messages)
- **Depended on by**: The Next.js router renders these pages based on URL matching

## For new engineers

- **Modify first**: `page.tsx` if you need to pre-fetch additional data for new conversations. `[id]/page.tsx` if you need to pre-fetch additional per-conversation data.
- **Gotchas**: These are server components -- they cannot use hooks, event handlers, or browser APIs. All interactive behavior must go in `ChatShell` or its children.
