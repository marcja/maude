# handlers

Pre-built MSW request handlers that simulate specific streaming scenarios. Each file exports a handler for `/api/chat` (or other API endpoints) with a deterministic event sequence, giving tests full control over what the client receives.

## Files

| File | Purpose |
|------|---------|
| `normal.ts` | Happy path: `message_start` -> two content deltas ("Hello" + " world") -> `message_stop` |
| `normal-alice.ts` | Same as `normal` but with `prompt_used` containing "Alice" -- tests system prompt display |
| `thinking.ts` | Reasoning trace: thinking block with two deltas, then content "The answer is 42." |
| `markdown.ts` | Content containing a fenced JS code block -- tests StreamingMarkdown rendering |
| `midstream-error.ts` | One content token ("Part") then an error event -- tests error state with minimal partial content |
| `midstream-error-partial.ts` | 10 content tokens then an error event -- tests error display with substantial partial content |
| `truncated.ts` | 8 content tokens then stream closes abruptly (no `message_stop`) -- tests truncation detection |
| `slow.ts` | 100 tokens at 100ms intervals (~10s total) -- tests cancellation and auto-scroll mid-stream |
| `stall.ts` | 5 fast tokens, 10s pause, 5 more tokens -- tests the 8s stall detection threshold |
| `hold.ts` | Opens an SSE stream but never emits events; closes only on abort -- tests abort/cancellation lifecycle |
| `zero-usage.ts` | Normal flow but `message_stop` usage has zeros -- tests client-side token count fallback |
| `conversations.ts` | GET/DELETE handlers for `/api/conversations` and `/api/conversations/:id` with fixture data |
| `settings.ts` | GET/POST handlers for `/api/settings` with in-memory state -- tests settings persistence without SQLite |

## Architecture decisions

- **One file per scenario**: Each handler is a self-contained test scenario. Adding a new test scenario means adding one new handler file, not modifying shared infrastructure.
- **Sync handlers via `createSyncHandler`**: Most handlers use the factory from `handlerFactory.ts` to synchronously stream a fixed event array. Only `slow.ts`, `stall.ts`, and `hold.ts` need real timing and use manual `ReadableStream` construction with the `delay()` utility.
- **String-keyed registry in `browser.ts`**: Playwright tests activate handlers by string key (`window.__msw.use('normal')`) because `page.evaluate()` can only serialize JSON values, not function references.

## Relationships

- **Depends on**: `src/lib/client/events.ts` (SSEEvent type), `src/mocks/handlerFactory.ts` (sync handler factory), `src/mocks/utils.ts` (encodeEvent, delay)
- **Depended on by**: `src/mocks/browser.ts` (imports all handlers for the string-keyed registry), test files that use `server.use()` or `useMSWHandler()`

## For new engineers

- **Modify first**: Copy an existing handler file (e.g., `normal.ts`) and adjust the event sequence. Then register it in `src/mocks/browser.ts`'s `HANDLERS` object to make it available to Playwright tests.
- **Gotchas**: Handlers that need real timing (delays, abort signal checks) cannot use `createSyncHandler` -- they must construct the `ReadableStream` manually. See `slow.ts` for the pattern.
