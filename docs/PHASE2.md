# Phase 2: Streaming Polish

## The goal

Phase 1 proved the architecture works: type a message, watch tokens stream in. Phase 2 makes the streaming experience *good*. By the end of this phase, you can watch a reasoning model think before it responds — the `<think>` trace appears live in a collapsible disclosure, auto-collapses when the model finishes reasoning, and shows how long it thought. Responses render as rich Markdown with code blocks, tables, and headings instead of raw text. If the model goes silent for eight seconds, the UI tells you it's still working and offers a Cancel button. And the auto-scroll logic that was inlined in the chat page is extracted to a properly tested, reusable hook.

That's the scope. No layout changes (still single-column). No conversation sidebar. No observability pane. No settings page. Phase 2 is about streaming quality — making the pipeline built in Phase 1 feel like a product rather than a prototype.

This is seven tasks (T11 through T17), thirteen commits (including one refactoring extraction mid-phase), and roughly 900 lines of new production code backed by about 1,200 lines of test code.

---

## The thinking block pipeline

### Detecting `<think>` tags in the token stream (T11)

Models like DeepSeek-R1 emit reasoning traces wrapped in `<think>...</think>` tags inline with the response tokens. The client needs to see these as separate semantic events — `thinking_block_start`, `thinking_delta`, `thinking_block_stop` — rather than raw text containing angle brackets.

The key question is *where* to do this detection. The model adapter returns raw tokens. The SSE parser yields typed events. The detection could live in either place, but it belongs in the BFF route for a specific reason: the adapter's job is to abstract the model backend (Ollama today, something else tomorrow), and thinking-tag detection is a presentation concern, not a model concern. A cloud API that natively supports thinking blocks wouldn't emit `<think>` tags at all — it would have separate response fields. By putting the detection in the BFF, we keep the adapter clean and let the BFF translate *any* backend's output into the app's event protocol.

The hard part is that `<think>` and `</think>` tags can straddle token boundaries. The model doesn't align its tokens to XML tags — a single token might contain `"Hello <th"`, with `"ink>"` arriving in the next chunk. A naive `indexOf('<think>')` on each token would miss this.

The solution is a two-layer parser. The first layer, `processBuffer`, maintains a state machine with two states (`'content'` and `'thinking'`) and a buffer that holds text that might be part of an incomplete tag:

```typescript
function processBuffer(
  buffer: string,
  state: StreamingParserState
): { chunks: StreamingChunk[]; state: StreamingParserState; remaining: string } {
  const OPEN_TAG = '<think>';
  const CLOSE_TAG = '</think>';
  const chunks: StreamingChunk[] = [];
  let current = buffer;
  let currentState = state;

  while (current.length > 0) {
    if (currentState === 'content') {
      const idx = current.indexOf(OPEN_TAG);
      if (idx === -1) {
        const safeEnd = partialTagEnd(current, OPEN_TAG);
        if (safeEnd > 0) chunks.push({ kind: 'content', text: current.slice(0, safeEnd) });
        return { chunks, state: currentState, remaining: current.slice(safeEnd) };
      }
      // ... tag found: emit content before it, push thinking_start, switch state
    }
    // ... symmetric logic for 'thinking' state with CLOSE_TAG
  }
  return { chunks, state: currentState, remaining: '' };
}
```

The `partialTagEnd` helper is the critical detail. Given a buffer like `"Hello <th"` and the tag `"<think>"`, it returns 6 — the index where a potential partial match begins. Everything before that index (`"Hello "`) is safe to emit immediately. The suffix (`"<th"`) must be held back until the next token either completes the tag (`"ink>"` → it was `<think>`, switch state) or proves it wasn't a tag at all (`"ings"` → emit `"<things"` as content).

```typescript
function partialTagEnd(buffer: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, buffer.length); k >= 1; k--) {
    if (buffer.endsWith(tag.slice(0, k))) {
      return buffer.length - k;
    }
  }
  return buffer.length;
}
```

The approach is conservative: it holds back text that *might* be a tag even when most of the time it won't be. The latency cost is negligible — at most `tag.length - 1` characters (6 characters for `<think>`) are delayed by one token interval, which is typically under 30ms. Correctness matters more than shaving microseconds off the display of a handful of characters.

### The chunk dispatcher (T28 refactoring)

The first implementation of T11 put the SSE event emission logic directly in the `for await` loop. A post-commit refactoring (T28) extracted it into a `ChunkDispatcher` class that encapsulates block open/close state:

```typescript
class ChunkDispatcher {
  private contentBlockOpen = false;
  private thinkingBlockOpen = false;
  private accumulatedContent = '';
  private accumulatedThinking = '';

  constructor(private readonly sink: DispatchSink) {}

  dispatch(chunk: StreamingChunk): void {
    if (chunk.kind === 'thinking_start') {
      if (this.contentBlockOpen) {
        this.sink.enqueue(encode({ type: 'content_block_stop' }));
        this.contentBlockOpen = false;
      }
      this.sink.enqueue(encode({ type: 'thinking_block_start' }));
      this.thinkingBlockOpen = true;
    } else if (chunk.kind === 'content') {
      // Lazy content_block_start: open only when first content chunk arrives.
      if (!this.contentBlockOpen) {
        this.sink.enqueue(encode({ type: 'content_block_start' }));
        this.contentBlockOpen = true;
      }
      // ... emit content_block_delta, accumulate
    }
    // ... symmetric for thinking/thinking_stop
  }
}
```

Two design decisions stand out here. First, the content block start is *lazy* — it only emits `content_block_start` when the first content chunk actually arrives. If the model emits a thinking trace and then errors before producing visible content, no unnecessary content block events are emitted. Second, the dispatcher accumulates content and thinking text separately, so the BFF can persist them to the database independently when the stream completes. The `thinking` column on the `messages` table (which existed since Phase 1 but was unused) now receives the reasoning trace, keeping it separate from the visible response.

The main token loop in the route handler is now thin — it feeds tokens into `processBuffer` and dispatches the resulting chunks:

```typescript
for await (const token of tokens) {
  parserBuffer += token;
  const result = processBuffer(parserBuffer, parserState);
  parserState = result.state;
  parserBuffer = result.remaining;

  for (const chunk of result.chunks) {
    dispatcher.dispatch(chunk);
  }
}
```

---

## Making thinking visible (T12)

### The ThinkingBlock component

`src/components/chat/ThinkingBlock.tsx` is a purely presentational component with three display states, all driven by props:

1. **Streaming** (`isThinking=true`): shows "Thinking..." with the content visible so the user can watch the model reason in real time. The toggle button is disabled — collapsing a live stream of reasoning text would hide the most interesting part of the interaction.

2. **Completed** (`isThinking=false`, `text` is non-empty): shows "Thought for Xs" with the content collapsed by default. Reasoning traces are valuable for debugging but clutter the chat for normal use. Collapsed-by-default keeps the conversation clean while making the trace one click away.

3. **No thinking** (`isThinking=false`, `text` is empty): renders nothing. Not all models emit thinking blocks, and the component shouldn't leave an empty disclosure element in the DOM when there's nothing to disclose.

```typescript
export function ThinkingBlock({ text, isThinking, durationMs }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);

  if (!isThinking && !text) return null;

  const label = isThinking ? 'Thinking...' : `Thought for ${Math.floor((durationMs ?? 0) / 1000)}s`;
  const contentVisible = isThinking || open;
  // ...
}
```

The `durationMs` prop is computed externally — the parent measures wall-clock time between `thinking_block_start` and `thinking_block_stop` events. The component doesn't own a timer. This keeps it testable with static props and avoids coupling it to the streaming lifecycle.

---

## Markdown rendering (T13)

### StreamingMarkdown: tolerant by design

Phase 1 rendered assistant responses as plain text. Phase 2 adds `react-markdown` with `remark-gfm` (GitHub-Flavored Markdown: tables, strikethrough, task lists, autolinks).

The interesting question for a streaming chat is: what happens when the Markdown is incomplete? Mid-stream, the content might be `"Here is some code:\n\`\`\`js\nconst x = 1"` — an unclosed code fence. A strict Markdown parser would error or produce garbage.

The answer is that `react-markdown` is tolerant of partial input by design. Its underlying parser (micromark → mdast → hast → React) treats unclosed fences as plain text, incomplete bold markers as literal asterisks, and partial links as literal brackets. No `try/catch`, no buffer management, no special handling for streaming — the library just works with incomplete Markdown. This is the main reason it was chosen over alternatives that might be faster but less tolerant.

The component itself is simple, but it has one important performance detail:

```typescript
// Stable plugin array — defined outside the component so it isn't recreated
// on every render, which would cause react-markdown to re-parse unnecessarily.
const REMARK_PLUGINS = [remarkGfm];

// Stable component overrides — hoisted to module scope so react-markdown does
// not rebind on every render.
const COMPONENTS = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 text-xl font-bold">{children}</h1>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.startsWith('language-');
    return isBlock ? (
      <code className="block overflow-x-auto rounded bg-gray-100 px-3 py-2 font-mono text-sm">
        {children}
      </code>
    ) : (
      <code className="rounded bg-gray-100 px-1 font-mono text-sm">{children}</code>
    );
  },
  // ... headings, lists, tables, links, blockquotes
};

export function StreamingMarkdown({ content }: StreamingMarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}
```

Both `REMARK_PLUGINS` and `COMPONENTS` are hoisted to module scope. During streaming, this component re-renders on every token — 30 to 50 times per second. If these arrays and objects were defined inside the component body, each render would create new references. `react-markdown` checks referential equality to decide whether to re-parse; new references mean unnecessary re-parses. Hoisting to module scope ensures stable references across the entire component lifecycle.

The `code` override distinguishes block code from inline code by checking whether `className` starts with `language-`. `react-markdown` sets this class on `<code>` elements inside fenced blocks (e.g., `language-js` for a `\`\`\`js` fence) but not on inline `\`backtick\`` code. Block code gets a full-width background with horizontal scroll; inline code gets a compact background. This is the same visual distinction you see in GitHub's rendered Markdown.

---

## Stall detection (T14, T15)

### The problem

During normal streaming, tokens arrive at 30-50 per second and the UI feels responsive. But models can stall — a large context window, a complex reasoning step, resource contention on the GPU. When the token stream goes silent, the user sees a frozen interface with no indication of whether the model is still working or has hung. Eight seconds of silence is long enough that something is likely wrong, short enough that the user hasn't given up and closed the tab.

### useStallDetection: prop-driven, not imperative (T14)

The hook's API is declarative: the parent passes `isStreaming`, `lastTokenAt` (a timestamp set on each token arrival), and an `onStall` callback. The hook observes changes to these props rather than exposing an imperative `tick()` method:

```typescript
export function useStallDetection({ isStreaming, lastTokenAt, onStall }: UseStallDetectionProps) {
  const onStallRef = useRef(onStall);
  useEffect(() => {
    onStallRef.current = onStall;
  }, [onStall]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lastTokenAt is an intentional trigger dep
  useEffect(() => {
    if (!isStreaming) return;

    const id = setTimeout(() => {
      onStallRef.current();
    }, STALL_TIMEOUT_MS);

    return () => clearTimeout(id);
  }, [isStreaming, lastTokenAt]);
}
```

Three design decisions packed into 15 lines:

**`lastTokenAt` as a dependency that's not read.** The `useEffect` re-runs whenever `lastTokenAt` changes, which is exactly when the 8-second timer needs to reset. The cleanup function cancels the previous timeout; the new effect starts a fresh one. The actual *value* of `lastTokenAt` is irrelevant to the effect body — it's the *change* that matters. This pattern (dependency as trigger, not as value) is common in React but triggers Biome's exhaustive-deps rule, which sees a dependency that isn't read inside the effect. The `biome-ignore` comment explains why the lint suppression is correct.

**`onStall` in a ref.** If the caller passes an inline arrow function (`onStall: () => setIsStalled(true)`), a new function reference is created on every render. Without the ref, `onStall` would be in the dependency array, and every render would restart the 8-second timer — the stall would never fire during heavy streaming because tokens (and thus renders) arrive faster than 8 seconds. The ref breaks this cycle: the timer runs uninterrupted while the ref always points to the latest callback.

**No state, no return value.** The hook is a pure side effect — it fires a callback after a timeout. It doesn't own `isStalled` state because the parent needs to reset that state on conditions the hook doesn't know about (token arrival, stream end). Giving the parent the `onStall` callback and letting it manage the boolean keeps responsibilities clear.

### StallIndicator: pure presentation (T15)

`src/components/chat/StallIndicator.tsx` renders a "Still working..." banner with a Cancel button when `isStalled` is true. It renders nothing when false. The component is under 20 lines of JSX with an amber warning style and `role="status"` for screen readers. There's nothing architecturally interesting here — and that's the point. Stall detection complexity lives in the hook; the component is a trivial view of a boolean.

---

## Extracting useAutoScroll (T16)

Phase 1 had the auto-scroll logic inlined in the chat page — a `useEffect` that scrolled on token changes, a scroll handler that detected user override, and a "New content" button that resumed. T16 extracts this to `src/hooks/useAutoScroll.ts` with a proper API and independent test coverage.

The hook takes three props and returns four values:

```typescript
export function useAutoScroll({
  listRef,    // ref to scrollable container (owned by parent)
  isStreaming, // drives auto-scroll activation
  tokens,      // change triggers scroll (value not read)
}: UseAutoScrollProps): {
  scrollSuspended: boolean;     // user scrolled up >50px
  handleScroll: () => void;     // attach to container's onScroll
  scrollToBottom: () => void;   // imperative scroll + resume
  resetSuspension: () => void;  // resume without scrolling
}
```

### requestAnimationFrame coalescing

The core auto-scroll effect wraps the scroll update in `requestAnimationFrame`:

```typescript
useEffect(() => {
  if (!isStreaming || scrollSuspended) return;
  const id = requestAnimationFrame(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return () => cancelAnimationFrame(id);
}, [tokens, isStreaming, scrollSuspended, listRef]);
```

Without `requestAnimationFrame`, every token (30-50/sec) would synchronously assign `scrollTop`, triggering a layout reflow. Each reflow forces the browser to recalculate element positions before continuing JavaScript execution. At 50 tokens/sec, that's 50 forced reflows per second — visible jank, especially on complex DOM trees.

With `requestAnimationFrame`, multiple tokens arriving within a single display frame (~16ms at 60Hz) coalesce into one scroll update. The cleanup function (`cancelAnimationFrame`) ensures that if a new token arrives before the previous frame callback fires, the stale callback is cancelled and replaced. Result: at most one reflow per display frame, regardless of token rate.

Note that `scrollToBottom` (called by the "New content" button) does *not* use `requestAnimationFrame` — it's a synchronous scroll. This is intentional: when the user clicks a button, they expect immediate visual feedback. Coalescing makes sense for high-frequency streaming updates; it would feel sluggish for discrete user actions.

### The suspension threshold

```typescript
const handleScroll = useCallback(() => {
  const el = listRef.current;
  if (!el) return;
  setScrollSuspended(el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_THRESHOLD_PX);
}, [listRef]);
```

The gap calculation — `scrollHeight - scrollTop - clientHeight` — gives the distance from the current scroll position to the bottom of the scrollable content. If the user has scrolled more than 50 pixels above the bottom, auto-scroll suspends. The threshold is strict greater-than (`>`), not greater-than-or-equal — at exactly 50px, auto-scroll continues. This matches the spec (SPEC section 4.2: "more than 50px above the bottom").

The `resetSuspension` method exists for one specific case: when the user submits a new message. The new message goes to the bottom of the chat, and auto-scroll should resume so the user sees the response. But the user hasn't scrolled — so `handleScroll` won't fire. `resetSuspension` clears the flag without scrolling; the next token arrival triggers the `useEffect`, which scrolls to bottom.

---

## Extending useStream for Phase 2 (T17B)

The `useStream` hook gained four new pieces of state for Phase 2:

```typescript
export interface StreamState {
  // ... Phase 1 fields (tokens, isStreaming, ttft, error, failedMessages)
  thinkingText: string;            // accumulated reasoning text
  isThinking: boolean;             // true between thinking_block_start and stop
  thinkingDurationMs: number | null; // wall-clock duration of thinking block
  lastTokenAt: number | null;      // Date.now() of most recent content_block_delta
}
```

Each addition follows the same patterns established in Phase 1.

**Thinking text accumulation** mirrors the token accumulation pattern: a ref (`thinkingTextRef`) holds the synchronous value for `onComplete`, while `startTransition` defers the state update so user interactions stay responsive during fast reasoning:

```typescript
case 'thinking_delta':
  thinkingTextRef.current += event.delta.text;
  // startTransition: same non-urgent priority as content deltas —
  // thinking text accumulation should not block user interactions.
  startTransition(() => {
    setState((prev) => ({
      ...prev,
      thinkingText: prev.thinkingText + event.delta.text,
    }));
  });
  break;
```

**Thinking duration** uses `performance.now()` (not `Date.now()`) for the same reason as TTFT: it's a monotonic clock unaffected by system clock adjustments. The start time is captured at `thinking_block_start` and subtracted at `thinking_block_stop`:

```typescript
case 'thinking_block_start':
  thinkingStartRef.current = performance.now();
  setState((prev) => ({ ...prev, isThinking: true }));
  break;

case 'thinking_block_stop': {
  const duration =
    thinkingStartRef.current !== null
      ? performance.now() - thinkingStartRef.current
      : null;
  thinkingDurationRef.current = duration;
  setState((prev) => ({
    ...prev,
    isThinking: false,
    thinkingDurationMs: duration,
  }));
  break;
}
```

**`lastTokenAt`** uses `Date.now()` (not `performance.now()`), which might seem inconsistent. The reason is that `useStallDetection` compares `lastTokenAt` against future `Date.now()` calls via `setTimeout` — both sides must use the same clock. `performance.now()` is reserved for duration measurements (TTFT, thinking block) where monotonicity matters more than wall-clock accuracy.

The `onComplete` callback was extended to include `thinkingText` and `thinkingDurationMs`, so the chat page can store finalized thinking data in the conversation history for re-display when the user scrolls back up.

---

## Wiring everything together (T17)

T17 was split into five sub-commits (T17A through T17E) because each is a distinct, independently testable change.

### T17A: Replace inline auto-scroll with the hook

A pure refactoring — the ~30 lines of inline scroll logic in the chat page become a single `useAutoScroll` call. No behavior change; the test suite confirms it.

### T17C: Wire ThinkingBlock and StallIndicator into the chat page

The chat page's render tree now has three new elements in the streaming section:

```tsx
{isStreaming && (
  <>
    <ThinkingBlock
      text={thinkingText}
      isThinking={isThinking}
      durationMs={thinkingDurationMs}
    />
    <MessageItem
      sender="assistant"
      content={tokens}
      isStreaming={isStreaming}
      ttft={ttft}
    />
    <StallIndicator isStalled={isStalled} onCancel={stop} />
  </>
)}
```

And in the history section, completed thinking blocks reappear when scrolling back:

```tsx
{history.map((m) => (
  <Fragment key={m.id}>
    {m.role === 'assistant' && m.thinkingText && (
      <ThinkingBlock
        text={m.thinkingText}
        isThinking={false}
        durationMs={m.thinkingDurationMs ?? null}
      />
    )}
    <MessageItem sender={m.role} content={m.content} ttft={m.ttft} />
  </Fragment>
))}
```

The stall state management is minimal — a `useState` boolean that's set to `true` by the `onStall` callback and reset to `false` by a `useEffect` that watches `lastTokenAt` and `isStreaming`:

```typescript
const [isStalled, setIsStalled] = useState(false);
useStallDetection({ isStreaming, lastTokenAt, onStall: () => setIsStalled(true) });

useEffect(() => {
  setIsStalled(false);
}, [lastTokenAt, isStreaming]);
```

The reset effect re-runs when either a new token arrives (resetting after a stall recovers) or when streaming ends (clearing the indicator if the stream finishes while stalled). This is another example of the "dependency as trigger" pattern: the effect doesn't read `lastTokenAt` or `isStreaming` — it just resets a boolean whenever they change.

---

## Testing the streaming polish

### New MSW handlers (T17D)

Phase 2 added four new MSW handlers, each designed to exercise a specific Phase 2 feature:

**`thinking.ts`** — Emits a complete thinking block sequence synchronously: `thinking_block_start` → two `thinking_delta` events → `thinking_block_stop` → content. No delays needed — unit tests verify state transitions, not timing.

**`stall.ts`** — The most interesting handler. It emits 5 tokens at 100ms intervals, then pauses for 10 seconds (exceeding the 8-second stall threshold), then emits 5 more tokens:

```typescript
// Phase 1: 5 tokens at 100ms — arrive before the stall threshold.
for (let i = 0; i < 5; i++) {
  if (request.signal.aborted) { controller.close(); return; }
  await delay(100, request.signal);
  // ...
  emit({ type: 'content_block_delta', delta: { text: `tok${i} ` } });
}

// Stall: 10s pause exceeds the 8s STALL_TIMEOUT_MS threshold.
await delay(10_000, request.signal);
```

The `delay` helper is abort-signal-aware — it rejects immediately if the signal fires during the delay, so the handler doesn't hold open a connection after the user clicks Cancel. Every abort check is doubled: once before the delay (in case the signal fired between loop iterations) and once after (in case it fired during the delay). This belt-and-suspenders approach prevents any token emission after cancellation.

**`markdown.ts`** — Emits content containing a fenced JavaScript code block, verifying that `StreamingMarkdown` renders `<code>` elements correctly.

**`midstream-error-partial.ts`** — Emits 10 tokens, then an SSE error event. Tests that partial content is preserved in the UI and the error bar with Retry button appears.

### Jest unit tests: hooks and components

**useStallDetection tests** use Jest fake timers for deterministic timing. The core pattern: render the hook with `isStreaming: true`, advance the fake clock by 8 seconds, and assert the callback fired. Then rerender with a new `lastTokenAt` to verify the timer resets:

```typescript
jest.useFakeTimers();
// ... render hook with isStreaming: true
act(() => jest.advanceTimersByTime(8000));
expect(onStall).toHaveBeenCalledTimes(1);

// New token resets the timer
rerender({ lastTokenAt: Date.now(), isStreaming: true, onStall });
act(() => jest.advanceTimersByTime(7999));
expect(onStall).toHaveBeenCalledTimes(1); // not called again yet
```

**useAutoScroll tests** mock `requestAnimationFrame` to invoke callbacks synchronously, and create mock refs with controllable scroll measurements. The key assertion: `scrollHeight - scrollTop - clientHeight > 50` suspends auto-scroll, but exactly 50 does not.

**ThinkingBlock tests** cover the three display states with static props — no streaming infrastructure needed. The component is purely presentational, so its tests are the simplest in the suite.

**StreamingMarkdown tests** verify that partial Markdown (unclosed code fences, incomplete bold markers) renders without throwing, and that complete Markdown produces the expected HTML elements (`<h1>`, `<strong>`, `<ul>`, `<code>`, `<table>`).

### Playwright E2E tests (T17E)

`tests/e2e/chat-m2.spec.ts` adds four end-to-end tests:

1. **Stall detection** — Sends a message with the `stall` handler, waits for `tok0` to appear (proving the initial tokens arrived), then waits up to 15 seconds for the stall indicator. Clicks Cancel and verifies the stream aborts while preserving partial content. This test is marked `test.slow()` because it necessarily waits 8+ real seconds for the stall threshold.

2. **Mid-stream error** — Uses `midstream-error-partial` to verify that the error bar appears with the error message and a Retry button after partial content has been displayed.

3. **Thinking blocks** — Sends a message with the `thinking` handler, waits for the visible response ("The answer is 42."), then verifies the ThinkingBlock is present with "Thought for" in its header, collapsed by default, and expandable to reveal the reasoning text.

4. **Markdown rendering** — Sends a message with the `markdown` handler and verifies that a `<code>` element containing the expected source text is rendered.

All four tests use the `sendChatMessage` helper extracted in a post-T17 refactoring — a four-step helper that navigates to `/chat`, activates the MSW handler, types the message, and presses Enter. This deduplication keeps each test body focused on its specific assertions.

---

## Where we ended up

At the end of Phase 2, the M2 (Streaming Polish) milestone is complete. Here's what works:

- **Thinking block visualization.** Models that emit `<think>` reasoning traces show them live during streaming, then auto-collapse them with a "Thought for Xs" header. Tags that straddle token boundaries are handled correctly by the BFF's state machine.
- **Markdown rendering.** Assistant responses render as rich Markdown with headings, code blocks, tables, lists, links, and blockquotes. Partial Markdown during streaming degrades gracefully.
- **Stall detection.** Eight seconds of silence triggers a "Still working..." indicator with a Cancel button. The indicator disappears when tokens resume.
- **Auto-scroll as a hook.** The scroll-to-bottom logic is extracted, independently tested, and uses `requestAnimationFrame` coalescing for performance.
- **Thinking data in history.** Thinking text and duration are persisted to the database and stored in the conversation history, so reasoning traces survive scroll-back.
- **Extended useStream state.** The hook now tracks `thinkingText`, `isThinking`, `thinkingDurationMs`, and `lastTokenAt`, with accumulator refs for all values.
- **Full test coverage.** Unit tests for every hook and component, plus four new Playwright E2E tests covering stall detection, mid-stream errors, thinking blocks, and Markdown rendering.

Here's what's deliberately missing:

- **`useDeferredValue` for Markdown.** Heavy Markdown re-parsing during fast streaming could benefit from deferred rendering — letting React show slightly stale Markdown while the expensive re-parse happens in the background. The spec calls for it, but the current `react-markdown` performance is acceptable without it. A future task can add it when profiling shows it's needed.
- **Syntax highlighting in code blocks.** Code fences render with a gray background but no language-specific coloring. A syntax highlighting library (like `highlight.js` or `shiki`) is a natural addition but outside the streaming polish scope.
- **Conversation history sidebar.** The database stores thinking traces alongside messages, but there's no UI to browse past conversations. Phase 4 adds the HistoryPane.
- **Settings page.** The prompt builder supports customization, but there's no UI to configure it. Phase 4.
- **Observability pane.** The `message_start` event carries `prompt_used` and `message_stop` carries usage stats, but nothing displays this data. Phase 3 adds the ObservabilityPane with metrics, event log, and system prompt tabs.

---

## What's next

[Phase 3](./PHASE3.md) adds the observability pane — a side panel that shows the system prompt the model received, a live event log of every SSE event as it arrives, and aggregate metrics (TTFT, token count, tokens per second). The single-column layout expands to a two-column layout: chat on the left, observability on the right. This is where the pedagogical purpose of the project becomes most visible — you can watch the streaming protocol in action while using the chat.
