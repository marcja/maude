# hooks

Custom React hooks that encapsulate the streaming chat lifecycle. These four hooks compose together in `ChatShell` to handle fetching, parsing, scrolling, stall detection, and observability.

## Files

| File | Purpose |
|------|---------|
| `useStream.ts` | Core streaming hook: fetches `/api/chat`, parses SSE via `parseSSEStream`, accumulates tokens/thinking/error state, exposes `send()` and `stop()` |
| `useAutoScroll.ts` | Manages scroll-to-bottom during streaming with `requestAnimationFrame` coalescing; suspends when user scrolls up, resumes on submit or button click |
| `useStallDetection.ts` | Fires `isStalled: true` when no content token has arrived for 8 seconds during an active stream |
| `useObservabilityEvents.ts` | Wraps `useStream` and emits lifecycle events (message_sent, stream_started, stream_completed, etc.) to `ObservabilityContext` via the `onEvent` callback pattern |

## Architecture decisions

- **Composition via props, not nesting**: The hooks don't call each other internally (except `useObservabilityEvents` which wraps `useStream`). `ChatShell` wires them together by passing shared values (`isStreaming`, `tokens`, `lastTokenAt`) as props. This keeps each hook independently testable.
- **Refs for synchronous access, state for rendering**: `useStream` mirrors accumulated values in refs (`tokensAccRef`, `ttftRef`) alongside React state. The `onComplete` callback reads refs for the final result because `startTransition` makes state updates async -- reading state immediately after the stream ends would give stale values.
- **`startTransition` for token accumulation**: Content and thinking deltas are wrapped in `startTransition` so the browser can prioritize user interactions (Stop button, scroll) over rendering the next token. Without this, heavy streaming makes the UI unresponsive to input.
- **`onEvent` callback pattern (dependency injection)**: `useStream` accepts an optional `onEvent` callback that fires for every SSE event before the hook's own processing. This lets `useObservabilityEvents` instrument the stream without modifying `useStream`'s core logic -- and without requiring an `ObservabilityProvider` in `useStream`'s tests.
- **`requestAnimationFrame` coalescing in auto-scroll**: Multiple tokens arriving within a single display frame (~16ms at 60Hz) would each trigger a synchronous layout reflow. rAF batches them into one scroll per frame.

## Relationships

- **Depends on**: `src/lib/client/sseParser.ts`, `src/lib/client/events.ts`, `src/context/ObservabilityContext.tsx`
- **Depended on by**: `src/components/chat/ChatShell.tsx` (the only consumer that composes all four hooks)

## For new engineers

- **Modify first**: `useStream.ts` to add handling for a new SSE event type, or `useObservabilityEvents.ts` to emit new observability metrics.
- **Gotchas**:
  - `useStream` does not depend on any React context -- this is intentional so its 40+ tests don't need provider wrappers. `useObservabilityEvents` adds the context dependency.
  - `lastTokenAt` uses `Date.now()` (not `performance.now()`) because `useStallDetection` compares it against future `Date.now()` calls. Duration measurements (TTFT, thinking block) use `performance.now()` for monotonicity.
  - Abort is treated as a successful termination (partial content preserved, `onComplete` called), not an error. This is intentional -- the user chose to stop.
