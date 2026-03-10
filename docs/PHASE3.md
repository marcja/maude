# Phase 3: Observability

## The goal

Phase 2 built a streaming experience that *feels* polished — thinking blocks, Markdown rendering, stall detection, auto-scroll. But all the interesting machinery is invisible. You can't see how long it took for the first token to arrive. You can't see which SSE events fired and in what order. You can't see the system prompt the model actually received. The streaming pipeline works, but you have to trust that it works because the only output is the chat itself.

Phase 3 makes the pipeline observable. By the end of this phase, there's a collapsible debug pane on the right side of the screen. Click the gear icon, and you see three tabs: Metrics shows per-request cards with TTFT, throughput, token counts, and duration. Events shows a chronological log of every lifecycle event — message sent, stream started, thinking started, stream completed, response copied. System Prompt shows the exact text that was sent to the model.

The layout changes from single-column to two-column: chat on the left, debug pane on the right. The pane collapses to a 32-pixel strip with a vertical "Debug" label, so it's always one click away without stealing screen real estate.

This is five tasks (T18 through T21, plus T29 refactoring), six commits, and roughly 500 lines of new production code backed by about 1,100 lines of test code. No changes to the streaming pipeline itself — Phase 3 is pure observation, not mutation.

---

## The event bus: ObservabilityContext (T18)

### The problem

The observability pane needs data from all over the application. The `useStream` hook knows when tokens arrive. The chat page knows when the user sends a message or copies a response. The BFF route emits the system prompt in its `message_start` event. This data needs to reach the debug pane without coupling every emitter to the pane's existence.

The standard React answer is context. But which shape?

### Why useReducer, not an external store

Three options were on the table: split contexts (one per data slice), a single context with `useReducer`, or an external store via `useSyncExternalStore`.

Split contexts solve the "re-render on unrelated changes" problem — the Events tab wouldn't re-render when a metric updates. But the debug pane is the *only* consumer, and it reads all three slices (events, requests, system prompt). If there's one consumer that needs everything, splitting saves nothing and adds wiring complexity.

An external store (Zustand, Jotai, or raw `useSyncExternalStore`) would work, but it introduces a state management pattern not used anywhere else in the codebase. For a teaching project, consistency matters more than theoretical performance.

That leaves a single context with `useReducer`. The reducer is a pure function — given state and action, it returns new state. This has a testing advantage that matters more than it seems at first glance: the reducer can be imported and tested directly, without rendering React components.

```typescript
export function observabilityReducer(
  state: ObservabilityState,
  action: ObservabilityAction
): ObservabilityState {
  switch (action.type) {
    case 'ADD_EVENT': {
      const newEvent: ObservabilityEvent = {
        ...action.event,
        id: crypto.randomUUID(),
      };
      const events = [newEvent, ...state.events].slice(0, MAX_EVENTS);
      return { ...state, events };
    }

    case 'START_REQUEST': {
      const requests = [action.request, ...state.requests].slice(0, MAX_REQUESTS);
      return { ...state, requests };
    }

    case 'UPDATE_REQUEST': {
      const idx = state.requests.findIndex((r) => r.id === action.id);
      if (idx === -1) return state;
      const updated = { ...state.requests[idx], ...action.updates };
      const requests = [...state.requests];
      requests[idx] = updated;
      return { ...state, requests };
    }
    // ...
  }
}
```

### Three state slices, two capacity caps

The state has three slices: `events` (a flat log, newest-first), `requests` (per-request metrics snapshots), and `systemPrompt` (the most recent prompt string).

Events are capped at 200, requests at 10. The cap is applied on every insert via `slice(0, MAX)`. Without a cap, a long session of rapid chatting would accumulate unbounded arrays. The limits are generous enough that you can scroll back through recent history, but the memory footprint stays predictable.

New entries prepend to the front of the array (newest-first), which matches the display order in both the Metrics and Events tabs. No reverse operation needed at render time.

### The event vocabulary is open, not enforced

`ObservabilityEvent.type` is `string`, not a union type. The context doesn't know or care about the event vocabulary — it just stores events. The emitter (the composition hook in T19) defines the specific event names. This keeps the context general: if a future feature adds new event types, the context doesn't change. The Events tab displays whatever `type` string it receives.

Similarly, `ObservabilityEvent.payload` is a pre-formatted string rather than structured data. The emitter formats "312ms TTFT" or "42 chars" at emission time, not at render time. This keeps the pane component dead simple — it just renders strings.

### The provider and consumer hook

The provider wraps the reducer in dispatch helpers (`addEvent`, `startRequest`, `updateRequest`, `setSystemPrompt`, `clear`) so consumers don't need to construct action objects:

```typescript
export function ObservabilityProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(observabilityReducer, INITIAL_OBSERVABILITY_STATE);

  const addEvent = (event: Omit<ObservabilityEvent, 'id'>) => {
    dispatch({ type: 'ADD_EVENT', event });
  };
  // ... other helpers
  return <ObservabilityContext value={value}>{children}</ObservabilityContext>;
}
```

The consumer hook, `useObservability()`, throws if called outside the provider — the standard guard pattern for required context.

---

## Bridging the stream: useObservabilityEvents (T19)

### Why a separate hook

The `useStream` hook has 40+ tests. None of them render an `ObservabilityProvider`. If observability logic were added directly to `useStream`, every test would need the provider, and the hook would be coupled to a context that has nothing to do with its core job (managing streaming state).

Instead, `useObservabilityEvents` is a composition hook. It wraps `useStream`, intercepts its lifecycle events via an `onEvent` callback, and emits observability events to the context. The chat page imports `useObservabilityEvents` instead of `useStream` — a two-line change.

```typescript
export function useObservabilityEvents() {
  const { addEvent, startRequest, updateRequest, setSystemPrompt } = useObservability();

  // ... refs for mutable tracking

  const onEvent = (event: SSEEvent) => {
    // Process raw SSE events and dispatch observability actions
  };

  const streamResult = useStream({ onEvent });

  // Wrap send() and stop() to emit lifecycle events
  return {
    ...streamResult,
    send: wrappedSend,
    stop: wrappedStop,
  };
}
```

This is dependency injection in React hooks form. `useStream` accepts an optional `onEvent` callback and calls it for every raw SSE event. It doesn't know or care what the callback does. The composition hook uses that callback to bridge SSE events to the observability context. Neither hook depends on the other's internals.

### Six refs, zero re-renders

The composition hook tracks mutable state across the stream lifecycle using refs:

- **`requestIdRef`**: Links all events from one request together. Reset on each `send()`.
- **`firstTokenRef`**: Boolean flag — emit `stream_started` (with TTFT) only on the first `content_block_delta`.
- **`tokenCountRef`**: Client-side delta counter. Incremented on each `content_block_delta`.
- **`startTimeRef`**: `performance.now()` at request start. Used to compute TTFT and duration.
- **`finalizedRef`**: Prevents duplicate terminal events (explained below).
- **`thinkingStartRef`**: `performance.now()` at `thinking_block_start`, for thinking duration calculation.

Every one of these is a ref, not state, for the same reason: they're bookkeeping values that change during streaming but should never trigger a re-render. A token counter that re-renders on every increment (30-50 times per second) would be catastrophic for performance. The refs are read only at lifecycle boundaries — when computing TTFT, when the stream completes, when the user cancels.

### The finalization guard

When a stream ends normally, the hook receives a `message_stop` event and emits `stream_completed`. When the user clicks Cancel, the hook's `wrappedStop()` fires and emits `stream_cancelled`. But what if the user clicks Cancel *after* `message_stop` has already arrived? Without a guard, both `stream_completed` and `stream_cancelled` would emit for the same request.

The `finalizedRef` flag prevents this. It's set to `true` on the first terminal event (either `message_stop` or `error`), and `wrappedStop()` checks it before emitting:

```typescript
const wrappedStop = () => {
  if (!finalizedRef.current && requestIdRef.current) {
    finalizedRef.current = true;
    const reqId = requestIdRef.current;
    const durationMs = performance.now() - startTimeRef.current;

    addEvent({
      type: 'stream_cancelled',
      payload: `${tokenCountRef.current} tok rcvd`,
      timestamp: Date.now(),
      requestId: reqId,
    });
    updateRequest(reqId, { status: 'cancelled', durationMs });
  }
  streamResult.stop();
};
```

The guard is necessary because `stop()` always calls `streamResult.stop()` (to abort the fetch), but only emits the cancellation event if the stream hasn't already finalized. This prevents the Events tab from showing misleading duplicate entries.

### Zero-usage fallback

Some models (and some Ollama configurations) return `0` for `output_tokens` in the usage stats. The hook falls back to the client-side delta count:

```typescript
case 'message_stop': {
  // Server may return 0 when the model doesn't support usage reporting.
  // Fall back to client-side delta count for output tokens.
  const serverOutput = event.usage.output_tokens;
  const outputTokens = serverOutput > 0 ? serverOutput : tokenCountRef.current;
  const serverInput = event.usage.input_tokens;
  const inputTokens = serverInput > 0 ? serverInput : null;
  // ...
}
```

Input tokens have no client-side equivalent (the client doesn't know how many tokens the model's tokenizer produced from the prompt), so they fall back to `null`, which the Metrics tab renders as "—".

### TTFT and the first-token flag

Time-to-first-token is the most useful single metric for streaming performance. It tells you how long the user waited between pressing Enter and seeing something happen.

The hook captures it on the first `content_block_delta` event by checking the `firstTokenRef` flag:

```typescript
case 'content_block_delta': {
  tokenCountRef.current += 1;
  if (!firstTokenRef.current) {
    firstTokenRef.current = true;
    const ttft = performance.now() - startTimeRef.current;
    addEvent({
      type: 'stream_started',
      payload: `${Math.round(ttft)}ms TTFT`,
      timestamp: Date.now(),
      requestId: reqId,
    });
    if (reqId) {
      updateRequest(reqId, { ttft });
    }
  }
  break;
}
```

`performance.now()` is used for the timing measurement (monotonic clock, not affected by system time adjustments), while `Date.now()` is used for the event timestamp (wall-clock time for display in the Events tab). This is the same clock discipline established in Phase 2: `performance.now()` for durations, `Date.now()` for timestamps.

---

## The debug pane: ObservabilityPane (T20)

### Pure view, no logic

`ObservabilityPane` is purely presentational. It reads from `ObservabilityContext` via `useObservability()` and renders one of three tab panels. The only internal state is `activeTab` — a string that selects which panel to show.

This means the pane has no lifecycle effects, no timers, no subscriptions. It re-renders when context state changes and paints the new data. All the intelligence lives in the context (storage) and the composition hook (emission). The pane just shows what's there.

### Color lookup maps

Status dots on metrics cards and badges on event rows need color mapping. Rather than scattering conditional class logic across JSX, the pane defines two lookup maps at module scope:

```typescript
const STATUS_DOT_CLASS: Record<RequestStatus, string> = {
  completed: 'bg-green-500',
  stalled: 'bg-amber-500',
  error: 'bg-red-500',
  cancelled: 'bg-gray-400',
  streaming: 'bg-blue-500',
};

const EVENT_BADGE_CLASS: Record<string, string> = {
  message_sent: 'bg-blue-100 text-blue-800',
  stream_started: 'bg-green-100 text-green-800',
  stream_stalled: 'bg-amber-100 text-amber-800',
  stream_error: 'bg-red-100 text-red-800',
  // ...
};
```

The `STATUS_DOT_CLASS` map is keyed by `RequestStatus` (a union type), so TypeScript enforces that every status has a color. The `EVENT_BADGE_CLASS` map is keyed by `string` because the event vocabulary is open — unknown event types fall back to a default grey badge. This asymmetry reflects the type safety difference: request status is a closed set; event types are open.

### Null-safe formatting

During streaming, most metrics are `null` — TTFT hasn't arrived yet, throughput can't be calculated until the stream ends, token counts aren't final. The card layout needs to stay stable while data fills in progressively.

Three formatting helpers handle this:

```typescript
function formatMetric(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${Math.round(value)} ${unit}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}
```

The em-dash ("—") preserves the card's grid layout. If null values rendered as empty strings, the grid cells would collapse and the card would shift when data arrived. A visible placeholder keeps things stable.

### File-internal sub-components

`MetricsCard`, `MetricCell`, and `EventRow` are defined in the same file as `ObservabilityPane`. They're not exported — they're layout-specific to this pane and not intended for reuse. Extracting them to separate files would add import ceremony without adding value. They're close to where they're consumed, which makes the rendering logic easy to follow top-to-bottom.

### The collapsed state

When collapsed, the pane renders a 32-pixel-wide clickable strip with a vertical "Debug" label:

```typescript
if (collapsed) {
  return (
    <button
      type="button"
      className="flex h-full w-8 cursor-pointer flex-col items-center border-l border-gray-200 bg-gray-50"
      onClick={onToggle}
      aria-label="Expand debug pane"
    >
      <span className="mt-4 text-xs text-gray-500" style={{ writingMode: 'vertical-rl' }}>
        Debug
      </span>
    </button>
  );
}
```

The entire strip is a `<button>`, not just the text. This makes the click target large and discoverable — you don't need to aim for the tiny "Debug" label. The `aria-label` provides accessibility context since the visual label is rotated text.

The `collapsed` prop and `onToggle` callback are owned by the parent (the chat page). The pane doesn't manage its own visibility state because the gear icon in the chat header also controls the toggle. Lifting this state to the parent gives one source of truth for both controls.

---

## Two-column layout (T21)

### The flex layout

The chat page's root element becomes a two-column flex container:

```tsx
<div className="flex h-screen w-full">
  {/* Center column — chat UI */}
  <div className="chat-page flex flex-1 min-w-0 flex-col">
    {/* Header with gear toggle */}
    {/* Chat content area — max-w-3xl keeps readable line lengths centered */}
    <div className="relative flex flex-1 min-w-0 flex-col max-w-3xl mx-auto w-full">
      {/* MessageList, InputArea, etc. */}
    </div>
  </div>

  {/* Right pane — always mounted */}
  <ObservabilityPane
    collapsed={!paneExpanded}
    onToggle={() => setPaneExpanded((prev) => !prev)}
  />
</div>
```

The center column uses `flex-1 min-w-0`. `flex-1` means it takes all remaining width after the right pane. `min-w-0` overrides the default `min-width: auto` on flex children, which prevents the column from overflowing when content (like long code blocks in Markdown) is wider than available space.

Inside the center column, the content wrapper retains `max-w-3xl mx-auto` — the same readable line-length constraint from Phase 2. The center column stretches to fill the viewport, but the actual content stays at a comfortable width and centers itself. When the pane expands from 32px to 300px, the center column shrinks, but the content stays centered within whatever width is available.

### Always mounted, never hidden

The pane is always rendered in the DOM — the `collapsed` prop controls whether it shows the 32px strip or the full 300px panel. An alternative would be to conditionally render the pane only when expanded (`{paneExpanded && <ObservabilityPane />}`), but this would destroy the context state on collapse. Events and metrics accumulated during the session would vanish when the user closes the pane and reappear empty when they reopen it.

By keeping the pane mounted, the `ObservabilityContext` state persists across toggle cycles. The user can chat with the pane closed, open it, and see all the metrics and events from the entire session.

### The gear toggle

A gear icon (⚙) in the chat header provides the primary toggle. Its color changes to blue when the pane is expanded, providing visual feedback for the current state:

```tsx
<button
  type="button"
  aria-label="Toggle debug pane"
  className={`p-1 text-lg transition-colors ${
    paneExpanded ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
  }`}
  onClick={() => setPaneExpanded((prev) => !prev)}
>
  ⚙
</button>
```

Two controls open the pane (the gear button and the collapsed strip) but only one closes it (the gear button). This is intentional: the collapsed strip is a "discover and open" affordance, while the gear icon is the persistent toggle. Having two ways to close would be redundant.

### Copy event emission

Phase 3 adds a `response_copied` event to the Events tab when the user copies an assistant message. The `MessageItem` component gains an `onCopy` callback prop:

```tsx
<MessageItem
  sender={m.role}
  content={m.content}
  ttft={m.ttft}
  onCopy={m.role === 'assistant' ? handleCopy : undefined}
/>
```

The `handleCopy` function emits a standalone event (no `requestId` — the copy isn't tied to a specific streaming request):

```typescript
const handleCopy = () => {
  addEvent({
    type: 'response_copied',
    payload: '',
    timestamp: Date.now(),
    requestId: null,
  });
};
```

This demonstrates a key property of the architecture: any component can emit events to the observability context without knowing about the debug pane. The context is a general-purpose event bus; the pane is just one consumer.

---

## Stall detection refinement

Phase 2 introduced `useStallDetection` as a callback-based hook — it accepted an `onStall` callback and the parent managed the `isStalled` boolean via `useState` + `useEffect`. This worked but created a small antipattern: derived state managed through an effect.

Phase 3 refactored the hook to own `isStalled` state internally and return it directly:

```typescript
export function useStallDetection({ isStreaming, lastTokenAt }: UseStallDetectionProps) {
  const [isStalled, setIsStalled] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lastTokenAt is an intentional trigger dep
  useEffect(() => {
    setIsStalled(false);

    if (!isStreaming) return;

    const id = setTimeout(() => {
      setIsStalled(true);
    }, STALL_TIMEOUT_MS);

    return () => clearTimeout(id);
  }, [isStreaming, lastTokenAt]);

  return { isStalled };
}
```

The effect resets `isStalled` to `false` on every run (token arrival or stream state change), then arms the 8-second timer only while streaming. The cleanup cancels the pending timeout. No external callback, no parent-side effect to mirror the state. The consumer just reads `isStalled` from the hook's return value.

This eliminated three lines in the chat page (the `useState`, the `useStallDetection` call with callback, and the reset `useEffect`) and replaced them with a single destructured call: `const { isStalled } = useStallDetection({ isStreaming, lastTokenAt })`. Less code, fewer moving parts, same behavior.

---

## MSW handler factory (T29)

### The duplication problem

By the end of T21, six MSW handlers followed the same pattern: define an array of SSE events, create a `TextEncoder`, build a `ReadableStream` that enqueues each event synchronously, and return an `HttpResponse` with `text/event-stream` headers. The event arrays differed; the boilerplate was identical. About 150 lines of duplicated encoder-stream-response plumbing across six files.

### The factory

`src/mocks/handlerFactory.ts` extracts the boilerplate into a single function:

```typescript
export function createSyncHandler(events: SSEEvent[]) {
  return http.post('/api/chat', () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}
```

Each handler file reduces to its event array and a one-liner:

```typescript
export const normalHandler = createSyncHandler([
  { type: 'message_start', message: { role: 'assistant' }, prompt_used: '...' },
  { type: 'content_block_start' },
  { type: 'content_block_delta', delta: { text: 'Hello ' } },
  { type: 'content_block_delta', delta: { text: 'world' } },
  { type: 'content_block_stop' },
  { type: 'message_stop', usage: { input_tokens: 10, output_tokens: 2 } },
]);
```

### Why a separate file from utils.ts

The factory imports `http` and `HttpResponse` from MSW. These imports pull in Node-specific internals that don't exist in Jest's jsdom environment. The existing `utils.ts` (which exports `encodeEvent` and `delay`) is imported by test files that run under jsdom. If the factory lived in `utils.ts`, those test imports would break.

Separating the factory into its own file keeps the import graph clean: `utils.ts` stays jsdom-safe (no MSW runtime imports), and `handlerFactory.ts` runs only in the browser (via MSW service worker) or in Playwright. The handler files import from both — `encodeEvent` from utils (for custom async handlers that still need to format events manually) and `createSyncHandler` from the factory (for the common synchronous case).

### What the factory doesn't cover

Async handlers — `stall.ts`, `slow.ts`, `hold.ts` — are not converted. They use `await delay()` between events, abort signal checks, and conditional logic that can't be expressed as a static event array. The factory is specifically for the synchronous case: emit all events immediately, close the stream. This is the common case for unit tests where timing doesn't matter. The async handlers remain hand-written because their timing behavior *is* the test scenario.

---

## Testing the observability layer

### ObservabilityContext: pure reducer tests

Because the reducer is exported as a standalone function, 8 of the 13 tests are pure function calls — no React rendering needed:

```typescript
it('ADD_EVENT prepends and caps at MAX_EVENTS', () => {
  let state = INITIAL_OBSERVABILITY_STATE;
  for (let i = 0; i < 210; i++) {
    state = observabilityReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'test', payload: `${i}`, timestamp: i, requestId: null },
    });
  }
  expect(state.events).toHaveLength(200);
  // Newest first: the last inserted event is at index 0
  expect(state.events[0].payload).toBe('209');
});
```

The remaining 5 tests verify the provider-hook contract: that `useObservability()` returns working dispatch helpers and that the hook throws outside the provider.

### useObservabilityEvents: composition hook tests

These tests render the hook inside both an `ObservabilityProvider` and a mock MSW server. They verify the event emission sequence for each lifecycle:

- `send()` emits `message_sent` with character count and creates a `RequestMetrics` with `streaming` status
- First `content_block_delta` emits `stream_started` with TTFT and updates the request's `ttft` field
- `message_stop` emits `stream_completed` with token count and duration, updates all metrics fields
- `stop()` before finalization emits `stream_cancelled`; after finalization emits nothing
- `error` event emits `stream_error` with truncated message (80 character limit)
- Multi-send resets all refs — TTFT and token count are independent per request
- Zero-usage fallback: when server returns 0 output tokens, the client-side delta count is used

The test for duplicate finalization is particularly important — it verifies that calling `stop()` after `message_stop` doesn't produce a `stream_cancelled` event. The `finalizedRef` guard is tested explicitly because a duplicate event would confuse anyone reading the Events tab.

### ObservabilityPane: component tests

26 tests cover the three tabs and their edge cases. The approach is to render the pane inside a provider with pre-loaded state (injected via the reducer) and assert on the rendered output:

- **Metrics tab**: empty state ("No requests yet"), card rendering per request, status dot colors (green/amber/red/grey/blue), TTFT and throughput formatting, "—" for null values, timestamp display
- **Events tab**: empty state, event rows with timestamp + type badge + payload, badge color mapping, newest-first ordering
- **System Prompt tab**: empty state, monospace pre-block rendering

The collapse/expand behavior is tested by toggling the `collapsed` prop and asserting that the 32px strip renders with the vertical "Debug" label.

### Playwright M3 E2E tests

`tests/e2e/chat-m3.spec.ts` has three end-to-end tests:

**Two conversations, metrics cards, and copy event.** Sends two messages (with a "New chat" between them), opens the debug pane, and verifies two metrics cards appear. Switches to the Events tab and checks for `stream_completed` events. Clicks the Copy button on an assistant message and verifies that `response_copied` appears in the event log. This test proves the full pipeline: `useStream` → `useObservabilityEvents` → `ObservabilityContext` → `ObservabilityPane`.

**System Prompt tab.** Uses the `normal-alice` handler, which includes a `prompt_used` field containing "Alice" in the `message_start` event. After sending a message, the test opens the debug pane, switches to the System Prompt tab, and verifies the pre-block contains "Alice". This proves that `prompt_used` flows from the SSE stream through the composition hook into the context and renders in the pane.

**Pane collapse/expand and center width.** Opens the pane, measures the center column width, collapses the pane, and verifies the center column is wider. This proves the flex layout works — the center column expands to fill the space freed by the collapsed pane. The test also verifies that the collapsed strip shows the "Debug" label and that expanding again restores the tab bar.

The `normal-alice` handler was created specifically for the System Prompt test. It's identical to the `normal` handler but with a different `prompt_used` value, making the assertion unambiguous — "Alice" can only come from the handler, not from default prompt text.

---

## The data flow, end to end

Here's how the pieces connect when the user sends a message:

```
User types → handleSubmit() → useObservabilityEvents.wrappedSend()
                                    │
                                    ├─ Emits message_sent (addEvent)
                                    ├─ Creates RequestMetrics (startRequest)
                                    └─ Delegates to useStream.send()
                                              │
                                              ▼
                                      fetch /api/chat (SSE)
                                              │
                                              ▼
                              SSE events arrive via onEvent callback
                                              │
                     ┌────────────────────────┼────────────────────┐
                     ▼                        ▼                    ▼
              message_start           content_block_delta     message_stop
              → setSystemPrompt       → tokenCountRef++       → stream_completed
                                      → stream_started        → updateRequest
                                        (first token only)      (metrics)
                                              │
                                              ▼
                              ObservabilityContext (reducer)
                                              │
                                              ▼
                              ObservabilityPane re-renders
                              → Metrics card updates
                              → Event row appears
                              → System prompt displays
```

The key property: the streaming pipeline (useStream) is unmodified. The composition hook wraps it. The context stores events. The pane reads them. Each layer does one thing.

---

## Where we ended up

At the end of Phase 3, the M3 (Observability) milestone is complete. Here's what works:

- **Live metrics cards.** Each request gets a card showing status (color-coded dot), TTFT, throughput, input/output token counts, and duration. Null values display as "—" during streaming, then fill in when the stream completes.
- **Event log.** Every lifecycle event appears as a timestamped, color-coded row. Events from different event types are visually grouped by color (blue for user actions, green for success, amber for thinking/stall, red for errors and cancellation).
- **System prompt display.** The exact system prompt text from the most recent request renders in a monospace pre-block. No truncation — you see exactly what the model received.
- **Two-column layout.** Chat fills the left; the debug pane sits at 300px on the right. The pane collapses to a 32px strip. The center column flexes to fill remaining width.
- **Copy event tracking.** Clicking Copy on an assistant message emits a `response_copied` event to the log, demonstrating that any component can be an event emitter.
- **MSW handler factory.** Six synchronous handlers reduced to event arrays plus one-liner factory calls, eliminating about 150 lines of duplicated boilerplate.
- **Comprehensive test coverage.** 50 new unit tests across context, hook, and component. 3 Playwright E2E tests proving the full integration pipeline.

Here's what's deliberately missing:

- **History sidebar.** The left pane from the three-column layout diagram in Phase 0 doesn't exist yet. Conversations are ephemeral — refresh the page and they're gone. Phase 4 adds the HistoryPane with database-backed conversation history.
- **Settings page.** The prompt builder supports customization, but there's no UI to configure the user's name, preferred response style, or model parameters. Phase 4.
- **Welcome page.** First-time users see the chat page directly. A welcome page with setup instructions and feature overview comes in Phase 4.
- **Stall event emission.** The `useStallDetection` hook detects stalls, but doesn't emit a `stream_stalled` event to the observability context. The Events tab shows the stall indirectly (a gap between `stream_started` and either `stream_completed` or `stream_cancelled`), but not as an explicit event. A future task can wire the stall callback to the context.
- **Event filtering and search.** The Events tab shows all events in chronological order. Filtering by type or searching by payload would be useful for long sessions but is outside the M3 scope.

---

## What's next

[Phase 4](./PHASE4.md) completes the application. The single-column-turned-two-column layout becomes a full three-column layout: conversation history on the left, chat in the center, observability on the right. The database that's been storing conversations since Phase 1 finally gets a UI — click a past conversation and it loads, with all messages and thinking traces intact. A settings page lets you configure the system prompt, and a welcome page greets first-time users. By the end of Phase 4, Maude is the complete application shown in the architecture diagram from Phase 0.
