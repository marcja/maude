# client

Client-side utilities for consuming the BFF's SSE stream. This directory defines the wire format contract (event types) and the parser that converts raw bytes into typed events.

## Files

| File | Purpose |
|------|---------|
| `events.ts` | Discriminated union (`SSEEvent`) of all SSE event types the BFF emits. The single authoritative schema for the client-server streaming contract |
| `sseParser.ts` | Async generator that reads a `ReadableStream<Uint8Array>` (i.e., `response.body`) and yields typed `SSEEvent` objects |

## Architecture decisions

- **Event schema lives here, not in `shared/`**: The SSE event types are a client-facing API contract. The server (BFF route) produces these events, but the types are defined from the consumer's perspective. Server code imports `SSEEvent` from here for type-safe event construction.
- **Async generator, not callback/event emitter**: `parseSSEStream` is an async generator (`async function*`) so consumers can use `for await...of`, which naturally handles backpressure, cleanup via `finally`, and early termination via `break`. A callback-based parser would require manual lifecycle management.
- **Chunk boundary handling via text buffer**: SSE data lines can be split across `ReadableStream` chunks. The parser accumulates a text buffer and only processes complete lines (split on `\n`), holding back the last element (which may be a partial line) for the next read.
- **Malformed JSON is skipped, not thrown**: A single corrupted line (e.g., from a connection reset) must not kill the entire stream. The parser catches JSON parse errors and continues.

## Relationships

- **Depends on**: Nothing external (only its own `events.ts`)
- **Depended on by**: `src/hooks/useStream.ts` (consumes the parser), `src/hooks/useObservabilityEvents.ts` (processes event types), `src/mocks/` (handler factory and utils use `SSEEvent` for type-safe mock construction), `src/app/api/chat/route.ts` (imports `SSEEvent` for serialization)

## For new engineers

- **Modify first**: `events.ts` -- when the BFF gains a new event type (e.g., `tool_use_start`), add it to the `SSEEvent` union here. All consumers use exhaustive `switch/case`, so TypeScript will flag every file that needs updating.
- **Gotchas**: The parser yields events with an `as SSEEvent` cast after checking for `type` field presence. Unknown `type` values pass through for forward-compatibility -- consumers must handle the default case in their switch statements.
