# api

Next.js App Router API routes that form the server-side API surface. Three route groups handle chat streaming, conversation management, and settings persistence.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`chat/`](chat/README.md) | BFF route: streams LLM responses as SSE, parses thinking tags, persists conversations |
| [`conversations/`](conversations/README.md) | CRUD for conversations: list all, get messages by ID, delete by ID |
| [`settings/`](settings/README.md) | Read and write user settings (name, personalization prompt) |

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat` | Stream a chat completion as SSE events |
| GET | `/api/conversations` | List all conversations (newest first) |
| GET | `/api/conversations/:id` | Get messages for a conversation |
| DELETE | `/api/conversations/:id` | Delete a conversation and its messages |
| GET | `/api/settings` | Get current settings |
| POST | `/api/settings` | Update settings |

## Architecture decisions

- **All routes import from `src/lib/server/`**: Route handlers are the only code that crosses the server-only boundary. They read from SQLite, call the model adapter, and return HTTP responses.
- **Shared validation pattern**: All routes that accept request bodies use manual validation with `ValidationError` from `apiHelpers.ts`. Validation errors return 400 with a JSON body.
- **No middleware**: Each route handles its own validation and error handling. The API surface is small enough that shared middleware would add indirection without reducing code.

## Relationships

- **Depends on**: `src/lib/server/` (all database and model access), `src/lib/client/events.ts` (SSEEvent type for the chat route)
- **Depended on by**: Client components via `fetch()`, MSW handlers that mock these endpoints in tests

## For new engineers

- **Modify first**: The route that matches your feature. New CRUD entities get a new directory (e.g., `api/tags/`). New streaming features go in `chat/route.ts`.
- **Gotchas**: The chat route returns HTTP 200 for all streaming responses, including errors. Only pre-stream validation failures return non-200 status codes. Errors during streaming are communicated as SSE events.
