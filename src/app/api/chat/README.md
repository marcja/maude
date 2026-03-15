# api/chat

The BFF (Backend-for-Frontend) route that translates between the client's SSE contract and Ollama's OpenAI-compatible streaming API.

## Files

| File | Purpose |
|------|---------|
| `route.ts` | POST handler: validates the request, builds the system prompt, streams tokens from the model adapter, parses `<think>`/`</think>` tags into structured thinking/content events, persists messages to SQLite, and emits the response as an SSE stream |

## Architecture decisions

- **BFF pattern**: The client never calls Ollama directly. This route is the translation layer that: (1) reads user settings from SQLite, (2) composes a system prompt, (3) streams from the model adapter, (4) translates Ollama's format into the app's Anthropic-style SSE schema (`SSEEvent` union), and (5) persists the conversation.
- **HTTP 200 even on model errors**: The SSE response starts with 200 before the first token arrives. If Ollama fails mid-stream, the error is communicated as a typed SSE `error` event within the stream body -- the HTTP status cannot change retroactively. Validation errors (bad request body) return 400 because they are caught before the stream starts.
- **Thinking-tag state machine**: The route contains a `processBuffer()` function that parses `<think>`/`</think>` tags from the raw token stream, handling tags that straddle token boundaries via a buffer. This converts inline thinking tags (from models like DeepSeek-R1) into structured `thinking_block_start`/`thinking_delta`/`thinking_block_stop` events. The `ChunkDispatcher` class manages SSE event serialization and block open/close state.
- **Manual SSE construction**: Events are serialized as `data: <json>\n\n` strings manually, not via a library. The format is simple enough that a library would add complexity without value.
- **No Zod**: Request validation uses manual type checks. For a single route, manual validation is clearer and avoids a dependency.
- **Persist only on success**: Database writes (conversation creation, message insertion) happen after the token stream is fully consumed. If the stream is aborted mid-flight, no DB rows are written.

## Relationships

- **Depends on**: `src/lib/server/modelAdapter.ts` (streams tokens from Ollama), `src/lib/server/db.ts` (persists conversations and messages), `src/lib/server/promptBuilder.ts` (composes system prompt), `src/lib/server/apiHelpers.ts` (ValidationError, jsonResponse), `src/lib/client/events.ts` (SSEEvent type for serialization)
- **Depended on by**: Client-side `useStream` hook fetches this endpoint. MSW handlers in `src/mocks/handlers/` simulate its responses.

## For new engineers

- **Modify first**: `route.ts` -- this is the only file. To add a new SSE event type, emit it via `controller.enqueue(encode({...}))` and add the type to `SSEEvent` in `src/lib/client/events.ts`.
- **Gotchas**:
  - The thinking-tag parser's `partialTagEnd()` function is subtle: it holds back buffer suffixes that could be the start of a `<think>` or `</think>` tag until the next token confirms or denies the match.
  - Abort signal propagation: `request.signal` is passed to `streamCompletion()` so clicking Stop in the client cancels the upstream Ollama request, not just the SSE stream.
  - `generateTitle()` prefers sentence boundaries over arbitrary truncation for conversation titles.
