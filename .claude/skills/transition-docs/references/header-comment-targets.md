# Header Comment Targets — Enhancement Checklist

Each file below needs its header comment reviewed and potentially enhanced.
The "Current Status" column reflects the existing header quality. The
"Non-Obvious Why Knowledge" column lists what a competent-but-SSE-naive
engineer would miss without guidance. The "Confusion Points" column lists
specific misunderstandings to preempt.

## Target files

### 1. `src/app/api/chat/route.ts`

**Current status**: Good JSDoc explaining BFF pattern, 5-step process, task scope.

**Non-obvious why knowledge to verify/add**:
- Why HTTP 200 is always returned (even on model errors) — SSE requires the
  response to start before the first event; switching to 500 mid-stream is
  impossible, so errors are SSE events, not HTTP status codes
- The thinking-tag state machine: why it exists in the BFF and not in the
  client or model adapter. The BFF is the only layer that sees raw tokens AND
  knows the SSE event schema
- Why the route builds SSE manually (`data: ${JSON.stringify(event)}\n\n`)
  instead of using a library — the format is trivial (two lines), and a
  library would obscure the pedagogical purpose
- Why `ReadableStream` is constructed with a `start` controller pattern
  instead of `TransformStream` — keeps the streaming logic in one visible
  function body rather than splitting across transform/flush callbacks

**Confusion points**:
- Engineer may expect error responses to have non-200 status codes
- Engineer may not realize `<think>` tags are raw text from Ollama, not part
  of the SSE protocol
- The `enqueue`/`close` pattern on ReadableStream may be unfamiliar

**Enhancement approach**: Verify existing header covers the above. Add any
missing points as additional bullet items in the existing comment block.

---

### 2. `src/lib/client/sseParser.ts`

**Current status**: Good explanation of purpose, client-side constraint, parsing strategy.

**Non-obvious why knowledge to verify/add**:
- Why async generator (`async function*`) instead of callback/EventEmitter —
  generators compose naturally with `for await...of`, making the consumer
  (useStream) a simple loop instead of callback management
- Chunk boundary handling: SSE events can arrive split across `reader.read()`
  calls. The buffer accumulates partial lines and only processes complete
  `\n\n`-terminated events
- UTF-8 decoding: `TextDecoder` with `{ stream: true }` handles multi-byte
  characters split across chunks — without this flag, a split emoji would
  produce garbage

**Confusion points**:
- Engineer may not know that `response.body` is a `ReadableStream<Uint8Array>`,
  not a string stream
- The `\n\n` delimiter (double newline) is SSE protocol, not application choice
- Generator return value semantics: the generator returns naturally when the
  stream ends; it does not throw

**Enhancement approach**: Verify existing header covers the above. The current
header mentions chunk boundary handling but may not explain the UTF-8 concern
or why generators were chosen over callbacks.

---

### 3. `src/hooks/useStream.ts`

**Current status**: Good explanation of AbortController ref, fine-grained
setState, and ref accumulators.

**Non-obvious why knowledge to verify/add**:
- `startTransition` wraps token-delta state updates — this tells React that
  rendering new tokens is lower priority than user input (typing, clicking
  stop). Without it, rapid token arrival can block input responsiveness
- Ref accumulators (`tokensAccRef`, `ttftRef`) exist because `startTransition`
  defers state updates, so reading state immediately after `setState` returns
  the old value. Refs are synchronous and always current
- The abort flow: `AbortController.abort()` → fetch promise rejects →
  generator's `finally` block runs → cleanup is guaranteed even if the
  generator is mid-yield

**Confusion points**:
- Engineer may think `startTransition` is for navigation (its most common
  use case) — here it's for streaming content priority
- Engineer may wonder why both state AND refs track the same value — the ref
  is for synchronous reads, state is for React rendering
- The `for await...of` loop over the async generator may be unfamiliar

**Enhancement approach**: Verify existing header covers startTransition
reasoning and ref/state duality. Add abort flow explanation if missing.

---

### 4. `src/lib/server/modelAdapter.ts`

**Current status**: Excellent — covers single-file env var rule, server-only
enforcement, adapter responsibilities, thinking-tag separation.

**Non-obvious why knowledge to verify/add**:
- `import 'server-only'` is a Next.js convention: the package throws at
  build time if a client bundle transitively imports this module. It's a
  compile-time firewall, not a runtime check
- The adapter yields raw strings, not parsed events — keeping it as a thin
  I/O wrapper means the BFF route controls all event semantics
- `ModelAdapterError` is a typed error class (not a generic Error) so the
  BFF can distinguish connection failures from other exceptions

**Confusion points**:
- Engineer may try to add thinking-tag logic here (it belongs in route.ts)
- Engineer may not know what `server-only` does if they haven't used Next.js
  App Router

**Enhancement approach**: Existing header is strong. Verify `server-only`
explanation is detailed enough for someone new to Next.js App Router.

---

### 5. `src/mocks/handlerFactory.ts`

**Current status**: Good — explains extraction from repeated boilerplate,
separation from utils.ts due to jsdom limitation.

**Non-obvious why knowledge to verify/add**:
- Why factory pattern: each test scenario needs a handler with the same
  structure (intercept POST /api/chat, stream events, close) but different
  event sequences. The factory eliminates that boilerplate
- Sync vs async handlers: the factory creates synchronous handlers (all
  events written in one pass) which is correct for unit tests. Async handlers
  (with delays) are used only for stall/slow scenarios
- Why separate from utils.ts: `http` and `HttpResponse` from MSW import
  Node/browser internals that crash in Jest's jsdom environment. utils.ts
  must stay jsdom-safe because it's imported by test files

**Confusion points**:
- Engineer may try to merge handlerFactory.ts into utils.ts and break Jest
- Engineer may not understand why some handlers are in separate files instead
  of inline in tests — the handler files serve as named test fixtures

**Enhancement approach**: Verify existing header explains the jsdom
limitation clearly. Add the "named test fixtures" perspective if missing.

---

### 6. `src/lib/client/events.ts`

**Current status**: Concise explanation of discriminated union as single
source of truth.

**Non-obvious why knowledge to verify/add**:
- The discriminated union is the API contract between the BFF and the client.
  Adding a new event type requires changes in: events.ts (type), route.ts
  (emitter), sseParser.ts (it passes through), and useStream.ts (consumer)
- Why Anthropic-style event names (`message_start`, `content_block_delta`)
  instead of Ollama's format — the app is a pedagogical tool for building
  Anthropic-style UIs, and the event schema reflects the target API
- `prompt_used` on `message_start` is optional because it's only emitted
  when the BFF includes the composed system prompt for observability

**Confusion points**:
- Engineer may think these types match a real Anthropic API (they're inspired
  by it but simplified)
- Engineer may not realize the discriminated union enables exhaustive switch
  statements in consumers — TypeScript will flag unhandled event types

**Enhancement approach**: Add the "API contract" perspective and the
exhaustive switch benefit if not already present.

---

### 7. `src/context/ObservabilityContext.tsx`

**Current status**: Excellent — covers useReducer choice, exported reducer,
string-typed events, pre-formatted payload.

**Non-obvious why knowledge to verify/add**:
- The context is an event bus: components emit events, one consumer (the
  debug pane) displays them. This decouples observability from streaming
  logic — useStream doesn't need to know about the debug pane
- `useReducer` instead of `useState` because the state shape has three
  slices (events, metrics, errors) that update independently. useReducer
  makes the update logic testable as a pure function
- The reducer is exported so tests can verify state transitions without
  rendering React components

**Confusion points**:
- Engineer may expect a pub/sub library or external store — the context IS
  the event bus
- Engineer may wonder why metrics aren't computed in the pane component —
  centralizing in the reducer keeps the pane as a pure display component

**Enhancement approach**: Existing header is strong. Verify "event bus"
framing is explicit.

---

### 8. `src/hooks/useAutoScroll.ts`

**Current status**: Good — covers listRef as prop, scrollSuspended ownership,
tokens as trigger dependency.

**Non-obvious why knowledge to verify/add**:
- `requestAnimationFrame` coalescing: multiple token deltas can arrive within
  a single frame. The hook batches scroll updates by scheduling one rAF per
  frame, avoiding forced layout thrashing from calling `scrollTop = ...`
  on every token
- Scroll suspension: when the user scrolls up to read earlier content, auto-
  scroll stops. It resumes only when the user scrolls back near the bottom
  OR when a new message is submitted (via `resetSuspension`)
- The threshold for "near bottom" is intentionally generous (not pixel-
  perfect) to avoid frustrating edge cases where a few pixels prevent resume

**Confusion points**:
- Engineer may not know what "layout thrashing" is or why scrolling on every
  token is expensive
- Engineer may try to replace rAF with a throttle/debounce — rAF is the
  correct primitive because it aligns with the browser's paint cycle

**Enhancement approach**: Verify rAF coalescing rationale is in the header.
Add layout thrashing explanation if missing.

---

### 9. `src/hooks/useStallDetection.ts`

**Current status**: Good — covers prop-driven design, internal state, and
useEffect for timer.

**Non-obvious why knowledge to verify/add**:
- Timer lifecycle: the effect sets a timeout on every `lastTokenAt` change.
  If a new token arrives before the timeout fires, the effect cleanup cancels
  the old timer. Stall is only detected when NO token arrives for the full
  timeout duration
- Why prop-driven instead of imperative `tick()`: declarative hooks are
  easier to test (pass props, assert output) and eliminate a class of bugs
  where the caller forgets to call tick
- Coupling to streaming state: the timer only runs when `isStreaming` is
  true. This prevents false stall detection after the stream completes
  naturally (no more tokens expected)

**Confusion points**:
- Engineer may think stall detection requires polling or setInterval — it's
  a single setTimeout that resets on each token
- Engineer may try to add stall detection to useStream directly — keeping it
  separate follows single-responsibility and makes it independently testable

**Enhancement approach**: Verify timer lifecycle (setTimeout, not setInterval)
is clearly explained. Add the streaming-state coupling rationale if missing.

---

### 10. `src/components/chat/StreamingMarkdown.tsx`

**Current status**: Good — covers react-markdown tolerance of partial input,
remark-gfm, inline prose classes.

**Non-obvious why knowledge to verify/add**:
- Stable `components` overrides: the overrides object is defined outside the
  component (or memoized) to prevent react-markdown from re-creating renderers
  on every render. During streaming, this component re-renders on every token
  delta — unstable overrides would cause expensive reconciliation
- Render frequency: this component receives new content on every SSE delta
  event (potentially dozens per second). Performance depends on react-markdown's
  incremental parsing and stable references
- Why not `dangerouslySetInnerHTML`: react-markdown parses to a React element
  tree, preserving React's reconciliation. Raw HTML would bypass the virtual
  DOM and break on partial streaming input

**Confusion points**:
- Engineer may add inline object literals to the `components` prop and cause
  performance regression during streaming
- Engineer may think react-markdown needs special handling for incomplete
  input — it doesn't, by design

**Enhancement approach**: Verify stable overrides rationale is in the header.
Add render frequency concern and why not `dangerouslySetInnerHTML` if missing.

## Completion tracking

Mark each file done as its header is reviewed/enhanced:

- [ ] 1. `src/app/api/chat/route.ts`
- [ ] 2. `src/lib/client/sseParser.ts`
- [ ] 3. `src/hooks/useStream.ts`
- [ ] 4. `src/lib/server/modelAdapter.ts`
- [ ] 5. `src/mocks/handlerFactory.ts`
- [ ] 6. `src/lib/client/events.ts`
- [ ] 7. `src/context/ObservabilityContext.tsx`
- [ ] 8. `src/hooks/useAutoScroll.ts`
- [ ] 9. `src/hooks/useStallDetection.ts`
- [ ] 10. `src/components/chat/StreamingMarkdown.tsx`
