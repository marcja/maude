# Phase 1: The Streaming Pipeline

## The goal

Phase 1 has one job: prove the architecture works end to end. By the end of this phase, you can type a message into a text box, hit Enter, and watch tokens stream in from a local LLM. You can click Stop mid-stream and keep the partial response. You can scroll up during a long response and the auto-scroll pauses. You can scroll back down and it resumes.

That's it. No markdown rendering (tokens appear as plain text). No thinking block visualization. No conversation history sidebar. No settings page. No observability pane. Just one single-column chat interface that proves every layer of the streaming pipeline — from SQLite to model adapter to BFF to SSE parser to React hook to rendered DOM — works correctly, is tested, and is ready to build on.

This is ten tasks (T01 through T10), ten commits, and about 1,800 lines of production code backed by roughly the same amount of test code.

---

## Building bottom-up

The task ordering is deliberate: build the server layer first, then the BFF route, then the client utilities, then the React hook, then the UI components, and finally wire everything together. Each layer is independently testable — you can run the model adapter tests without having the SSE parser, and the SSE parser tests without having the React hook.

```
T01  SQLite schema + DB helpers
T02  Model adapter (Ollama)          ← server layer
T03  SSE parser                      ← client utility (no React dependency)
T04  Prompt builder
T05  BFF route (happy path)          ← connects T01, T02, T04
T06  useStream hook                  ← connects T03 to React
T07  MessageItem component           ← pure presentation
T08  InputArea component             ← pure presentation
T09  BFF route (abort + persistence) ← completes T05
T10  Chat page + E2E tests           ← wires everything together
```

This ordering means each task can write focused tests against a single concern. The model adapter tests mock `fetch`. The SSE parser tests create synthetic `ReadableStream` instances. The `useStream` hook tests use MSW to serve canned SSE responses. No task needs to mock five things at once.

---

## The server layer

### SQLite: synchronous by design (T01)

The database layer lives in `src/lib/server/db.ts` and uses `better-sqlite3` for a reason that surprises people coming from the Node.js world: it's synchronous.

Here's the conventional wisdom: Node.js is single-threaded, so you should never block the event loop with synchronous I/O. Use `async`/`await` for everything.

Here's the reality for an embedded SQLite database: the "I/O" is reading a file from local disk. It completes in microseconds. Wrapping it in `async`/`await` doesn't make it non-blocking — SQLite doesn't support asynchronous operations at the engine level. What `async` *does* do is add overhead: promise allocations, microtask scheduling, and the cognitive load of `await`ing every database call. `better-sqlite3` skips all of that with a direct N-API binding to the SQLite C library.

The schema has three tables:

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  thinking TEXT,  -- nullable; stores thinking block content if present
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

The `db.ts` module exports named functions (`getSettings`, `createConversation`, `insertMessage`, etc.), each backed by a prepared statement that's cached at module load time. No ORM, no query builder — just SQL strings and typed return values.

One detail worth noting: the `thinking` column on `messages` exists from the start even though thinking block support isn't implemented until Phase 2. The schema is designed once; altering tables later is messy. Including the column now costs nothing and avoids a migration later.

### The model adapter: one file, one backend (T02)

`src/lib/server/modelAdapter.ts` is the only file in the project that knows Ollama exists. It reads two environment variables — `OLLAMA_BASE_URL` and `MODEL_NAME` — and exports a single function:

```typescript
export async function streamCompletion(
  messages: ChatMessage[],
  systemPrompt: string,
  signal: AbortSignal
): Promise<AsyncIterable<string>>
```

You hand it a conversation and a system prompt, and you get back an async iterable of raw token strings. The caller drives consumption with `for await...of`. The adapter handles connection failures by throwing a typed `ModelAdapterError` with a code (`'model_unreachable'` or `'bad_response'`) so the BFF can map errors to specific UI messages instead of showing a generic "something went wrong."

Under the hood, the adapter contains a private `tokenStream` generator that reads Ollama's OpenAI-compatible SSE format:

```typescript
async function* tokenStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        // ... parse data: lines, extract content, yield tokens
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

This pattern — buffer incoming bytes, split on newlines, keep the last incomplete line for the next chunk — appears in two places in the codebase (here and in the client-side SSE parser). It's the fundamental technique for reading any line-delimited streaming protocol from a `ReadableStream`. You'll use the same pattern for NDJSON (newline-delimited JSON, common in logging and event pipelines), CSV streams, log tailing, and any protocol where messages are separated by newlines. The buffer exists because network chunks don't align with logical message boundaries: a single SSE event might arrive split across two TCP packets, or three events might arrive in one chunk.

The `finally` block is important too. `reader.releaseLock()` ensures the `ReadableStream` can be garbage collected even if the consumer breaks out of the `for await` loop early — which is exactly what happens when the user clicks Stop.

### The prompt builder (T04)

This one is simple and that's the point. `promptBuilder.ts` exports a function that takes user settings (name, personalization prompt) and composes a system prompt:

```typescript
export function buildSystemPrompt(settings: UserSettings): string {
  const parts = [BASE_SYSTEM_PROMPT];
  if (settings.name) parts.push(`The user's name is ${settings.name}.`);
  if (settings.personalizationPrompt) parts.push(settings.personalizationPrompt);
  return parts.join('\n\n');
}
```

The composed prompt is passed to the model adapter and also emitted in the `message_start` SSE event's `prompt_used` field, so the observability pane (Phase 3) can display exactly what the model received. Settings take effect on the next request, not mid-conversation — an intentional simplification that avoids the complexity of mid-stream prompt changes.

---

## The BFF translation layer (T05, T09)

This is the architectural heart of the project. The `/api/chat` route is a Next.js API handler that sits between the browser and Ollama, translating between two streaming formats and adding persistence.

### Why a BFF?

The browser could call Ollama directly — it's just an HTTP API. But a Backend-for-Frontend route gives us several things:

1. **Format translation.** The client code consumes a typed event protocol (`SSEEvent` discriminated union). Whether the backend is Ollama, a cloud API, or a local mock, the client doesn't know and doesn't care.

2. **Server-side concerns.** Reading settings from SQLite, composing the system prompt, persisting completed conversations — these happen on the server, invisible to the browser.

3. **Abort propagation.** When the user clicks Stop, the browser aborts its fetch to `/api/chat`. Next.js propagates that abort signal to the BFF route handler, which propagates it to the Ollama fetch. One abort cancels the entire chain.

4. **Typed errors.** The adapter throws `ModelAdapterError` with a code. The BFF maps that to an SSE error event. The client shows "Cannot reach Ollama" instead of "TypeError: Failed to fetch."

### The translation in practice

Here's the core of the BFF route — the part that reads tokens from Ollama and re-emits them as Anthropic-style SSE events:

```typescript
const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    controller.enqueue(
      encode({ type: 'message_start', message_id: messageId, prompt_used: systemPrompt })
    );

    const tokens = await streamCompletion(messages, systemPrompt, request.signal);
    controller.enqueue(encode({ type: 'content_block_start' }));

    let accumulatedContent = '';
    for await (const token of tokens) {
      accumulatedContent += token;
      controller.enqueue(
        encode({ type: 'content_block_delta', delta: { text: token } })
      );
    }

    controller.enqueue(encode({ type: 'content_block_stop' }));
    // ... persist to DB, emit message_stop ...
  },
});
```

The BFF creates its own `ReadableStream` and returns it as the response body. Inside the stream's `start` callback, it consumes the model adapter's async iterable and re-emits each token in the app's event format. The `encode` helper serializes an `SSEEvent` to the wire format (`data: <json>\n\n`).

### Persistence on completion, not on abort (T09)

T09 adds two behaviors to the BFF route:

1. **Abort signal propagation.** The `request.signal` is passed through to `streamCompletion`, so clicking Stop in the browser cancels the Ollama fetch server-side. The stream ends, no error event is emitted (the client already knows it stopped), and no database rows are written.

2. **Conversation persistence.** When the stream completes successfully (all tokens received), the route creates a conversation record (if this is a new conversation), inserts the user message, and inserts the assistant message with the accumulated content. This happens *after* the `for await` loop finishes and *before* `message_stop` is emitted.

The ordering matters. If the user aborts mid-stream, `streamCompletion` throws before the persistence code is reached — so no partial messages are saved. This is a deliberate choice: partial responses are shown in the UI (so the user sees what arrived before they stopped) but not persisted to the database (so conversation history only contains complete exchanges).

---

## The client streaming pipeline

### The SSE parser: bytes to typed events (T03)

`src/lib/client/sseParser.ts` is a pure utility — no React, no DOM, no side effects. It takes a `ReadableStream<Uint8Array>` (the `response.body` from a `fetch` call) and yields typed `SSEEvent` objects:

```typescript
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent>
```

It's an async generator, which means the consumer drives it: each `yield` pauses until the consumer asks for the next value. This naturally handles backpressure — if the consumer is slow (maybe React is mid-render), the parser waits.

The parsing strategy uses the same buffer-and-split technique as the model adapter's `tokenStream`. This is the core of SSE parsing over a `ReadableStream`, and it's worth understanding because the Web Streams API doesn't give you a line-oriented interface out of the box:

```typescript
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split('\n');
buffer = lines.pop() ?? '';  // keep incomplete line for next chunk
```

The `{ stream: true }` option on `TextDecoder.decode` is a subtle but critical detail. It tells the decoder to hold incomplete multi-byte sequences (relevant for UTF-8 non-ASCII characters, which LLMs produce frequently) across calls rather than replacing them with the replacement character. Without this, a Chinese character whose bytes arrive in two chunks would be decoded as two garbage characters instead of one valid one.

Malformed JSON payloads are silently skipped — a `try/catch` around `JSON.parse` ensures that a single bad line (from a network glitch, a truncated connection) doesn't crash the entire stream. This is defensive by design: the parser's job is to yield what it can, not to enforce correctness.

### The useStream hook: React meets streaming (T06)

`src/hooks/useStream.ts` is where the streaming pipeline meets React's state model, and it's where most of the interesting design decisions live.

The hook exposes a simple API:

```typescript
export function useStream(): {
  tokens: string;        // accumulated response text
  isStreaming: boolean;   // true during active fetch
  ttft: number | null;   // time-to-first-token in milliseconds
  error: string | null;  // error message, if any
  send: (messages, conversationId?, onComplete?) => void;
  stop: () => void;
}
```

Components call `send()` to start a request and `stop()` to cancel it. The hook manages everything in between: creating the `AbortController`, making the fetch, parsing SSE events, accumulating tokens into state, measuring TTFT, and cleaning up.

One critical detail: `send()` begins by aborting any in-flight request (`abortRef.current?.abort()`) before creating a new controller. This cancel-before-send pattern isn't just about preventing interleaved responses — it's also necessary for callback safety. Each `send()` call receives its own `onComplete` closure. If the user rapidly submits twice, the first `onComplete` closure captures stale context (the history state at the time of the first send). Without the cancel, both `onComplete` callbacks could fire, writing duplicate or out-of-order messages into history. Aborting the first request ensures only the second `onComplete` fires.

Here are the design decisions that make this work correctly:

#### AbortController in a ref, not state

```typescript
const abortRef = useRef<AbortController | null>(null);
```

The `AbortController` is stored in a `useRef`, not `useState`. Why? Because calling `stop()` needs to access the current controller *without triggering a re-render*. If it were state, aborting the fetch would cause a render, which would re-run the hook, which could interfere with the in-progress stream teardown. A ref is invisible to React's render cycle — you can read and write it at any time without side effects.

#### startTransition for token accumulation

```typescript
case 'content_block_delta': {
  tokensAccRef.current += event.delta.text;
  // startTransition marks this update as non-urgent so the browser
  // can prioritize user interactions (Stop button clicks, scroll)
  // over rendering the next token.
  startTransition(() => {
    setState((prev) => ({
      ...prev,
      tokens: prev.tokens + event.delta.text,
    }));
  });
  break;
}
```

This is one of React 18's concurrent features in action. `startTransition` tells React that the state update inside it is "non-urgent" — React can interrupt it to handle higher-priority work like user input.

Without `startTransition`, consider what happens during heavy streaming: the model sends 50 tokens per second, each triggering a state update and re-render. If the user clicks Stop during this, the click event has to wait for the current render to finish. At 50 renders/second, that means up to 20ms of input delay — noticeable and frustrating.

With `startTransition`, React can interrupt a token render to process the Stop button click, then resume the token render afterward. The user experience changes from "my click was ignored" to "the Stop button responds instantly."

#### Ref mirroring for synchronous access

```typescript
const tokensAccRef = useRef('');
const ttftRef = useRef<number | null>(null);
```

These refs mirror the `tokens` and `ttft` state values. Every time a token arrives, it's written to *both* the ref and the state. Why the duplication?

Because of `startTransition`. When the stream ends and the hook calls `onComplete`, it needs to pass the final accumulated tokens. But the state value might not reflect the latest token yet — `startTransition` defers state updates, so `state.tokens` could be one or two tokens behind the actual stream position. The ref is always current because ref writes are synchronous. `onComplete` reads from the ref, not from state.

#### onComplete callback and React 18 automatic batching

The `send` function accepts an optional `onComplete` callback that fires when the stream finishes (either by `message_stop` or user abort):

```typescript
case 'message_stop':
  setState((prev) => ({ ...prev, isStreaming: false }));
  onComplete?.({ tokens: tokensAccRef.current, ttft: ttftRef.current });
  break;
```

The chat page uses this to move the live streaming message into the finalized history:

```typescript
send(nextContext, undefined, ({ tokens: t, ttft: f }) => {
  if (t) {
    setHistory((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'assistant', content: t, ttft: f },
    ]);
  }
});
```

React 18's automatic batching is what makes this work smoothly. In React 17, state updates in async callbacks (like inside a `for await` loop) were *not* batched — each `setState` call triggered a separate render. In React 18, all state updates are batched regardless of context. So when `message_stop` fires and the hook calls `setState({ isStreaming: false })` followed by `onComplete` calling `setHistory(...)`, React batches both into a single render. The live streaming message disappears and the finalized history message appears atomically — no flicker frame where neither or both are visible.

#### Abort is not an error

```typescript
catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    setState((prev) => ({ ...prev, isStreaming: false }));
    onComplete?.({ tokens: tokensAccRef.current, ttft: ttftRef.current });
  } else {
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }));
  }
}
```

When the user clicks Stop, the `AbortController.abort()` call causes the fetch to throw an `AbortError`. The hook catches this and treats it differently from a real error: it clears the streaming flag and calls `onComplete` with whatever tokens arrived before the abort. The partial response is preserved in the UI and added to the conversation history.

This is the correct behavior for user-initiated cancellation. The user chose to stop — they want to see what they got, not an error message.

#### Response validation before SSE parsing

Before handing the response body to the SSE parser, the hook checks `response.ok`:

```typescript
if (!response.ok) {
  const text = await response.text().catch(() => '');
  throw new Error(`Server returned HTTP ${response.status}${text ? `: ${text}` : ''}`);
}
```

This guards against a common production failure mode: a reverse proxy (nginx, Cloudflare, a load balancer) returning a 502 or 503 HTML error page instead of an SSE stream. Without this check, the SSE parser would silently skip every line (none start with `data:`), and the user would see no error and no response — just an empty message that never finishes. The `.catch(() => '')` on `response.text()` handles the edge case where even reading the error body fails (e.g., network interruption after headers).

---

## The components (T07, T08)

### MessageItem

`MessageItem` renders a single chat message — either user or assistant. User messages are right-aligned with a blue background. Assistant messages are left-aligned with a gray background. The interesting parts:

- **TTFT badge**: Assistant messages show a "↯ 312ms" badge when the time-to-first-token is known. This is a tiny piece of observability baked into the UI — you can see at a glance how responsive the model is.

- **Streaming spinner**: While the assistant message is actively streaming, a small spinner appears (with `role="status"` for accessibility). It disappears when `message_stop` arrives.

- **Copy button**: A clipboard icon lets you copy the response text. It uses `navigator.clipboard.writeText()` in a fire-and-forget pattern — no toast, no confirmation (that comes in Phase 3 with observability events).

### InputArea

`InputArea` is the text input and control bar at the bottom of the chat:

- **Enter submits, Shift+Enter inserts a newline.** This is the chat convention users expect. The handler calls `event.preventDefault()` on bare Enter to stop the default newline insertion.

- **Send/Stop button swap.** When `isStreaming` is false, the button says "Send" and calls `onSubmit`. When true, it says "Stop" and calls `onStop`. They're mutually exclusive — only one is ever visible.

- **Disabled when empty.** The Send button is disabled when the textarea is empty (after trimming whitespace). This prevents submitting blank messages.

- **Controlled component.** The textarea value lives in `useState`. This is intentional — the component needs to clear the input after submission and validate before enabling the Send button.

---

## Wiring it all together (T10)

T10 was split into two commits because the MSW browser infrastructure (T10A) and the chat page itself (T10B) are distinct deliverables.

### MSW browser infrastructure (T10A)

For unit tests, MSW uses `setupServer` — it patches Node.js's request handling so `fetch` calls are intercepted. For Playwright E2E tests, MSW uses `setupWorker` — it registers a Service Worker in the *browser* that intercepts `fetch` calls from the actual running application.

The browser MSW setup lives in `src/mocks/browser.ts` and exposes a handler registry:

```typescript
const handlerMap: Record<string, RequestHandler> = {
  normal: normalHandler,
  'midstream-error': midstreamErrorHandler,
  slow: slowHandler,
};
```

Playwright tests activate handlers via `window.__msw.use('normal')` — a function exposed on the window object that Playwright can call with `page.evaluate()`. This lets each test choose its scenario: happy path, error after 10 tokens, slow first token, etc.

The `MSWProvider` component wraps the app's root layout and initializes the service worker in non-production environments. It waits for the worker to be ready before rendering children, so there's no race between the app's first fetch and the mock being installed.

### The chat page (T10B)

`src/app/chat/page.tsx` wires everything together in about 165 lines:

```typescript
export default function ChatPage() {
  const [history, setHistory] = useState<Message[]>([]);
  const [scrollSuspended, setScrollSuspended] = useState(false);
  const { tokens, isStreaming, ttft, error, send, stop } = useStream();
  // ...
}
```

The page maintains two pieces of state: `history` (finalized messages) and `scrollSuspended` (whether auto-scroll is paused). It gets streaming state from `useStream`. `useState` is sufficient for M1 because there's no navigation — the chat page is the only page. Phase 4 introduces a conversation sidebar, which means the history must survive route transitions. That will require either URL-driven state or a context provider; `useState` won't scale past that point.

The rendering pattern for the live assistant message is worth noting:

```tsx
{history.map((m) => (
  <MessageItem key={m.id} sender={m.role} content={m.content} ttft={m.ttft} />
))}
{isStreaming && (
  <MessageItem sender="assistant" content={tokens} isStreaming={isStreaming} ttft={ttft} />
)}
```

Finalized messages come from `history` state. The live streaming message comes directly from `useStream`'s `tokens` — it's not in `history` yet. When `message_stop` fires, the `onComplete` callback adds the completed message to `history` and `isStreaming` goes to `false`, so the live message disappears and the finalized one appears. Thanks to React 18 batching, this swap is atomic.

### Auto-scroll

The auto-scroll logic is inline in T10 (it'll be extracted to a `useAutoScroll` hook in T16):

- During streaming, a `useEffect` scrolls to the bottom on every `tokens` change. The scroll is wrapped in `requestAnimationFrame` to coalesce multiple updates within a single display frame — without this, 30-50 tokens/second would each trigger a synchronous layout reflow via `scrollTop` assignment, causing jank. `rAF` ensures at most one scroll per frame (~60Hz).
- A scroll event handler checks if the user has scrolled more than 50px above the bottom. If so, auto-scroll is suspended.
- A "↓ New content" button appears when auto-scroll is suspended during streaming. Clicking it scrolls to the bottom and resumes auto-scroll.
- `scrollSuspended` resets to `false` when the user submits a new message, so the next response starts with auto-scroll active.

---

## Testing without a model

One of Maude's architectural goals is that you never need a running LLM to develop or test. MSW makes this possible at both test layers.

### Jest unit tests: `setupServer`

Each test file that needs fetch mocking creates an MSW server:

```typescript
import { setupServer } from 'msw/node';
import { normalHandler } from '../mocks/handlers/normal';

const server = setupServer(normalHandler);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

The `normalHandler` serves a canned SSE response — `message_start`, a few `content_block_delta` events, `message_stop`. Tests assert on the state produced by consuming this response. The `midstreamErrorHandler` emits tokens and then an error event, for testing error recovery. The `hold` handler opens a stream and never sends events, for testing abort behavior.

Each handler uses the `encodeEvent` utility from `src/mocks/utils.ts` to produce byte-for-byte identical SSE formatting to the production BFF. This ensures the SSE parser and `useStream` hook exercise the same code paths in tests and production.

### Playwright E2E tests: `setupWorker`

E2E tests run against the real Next.js dev server, with MSW intercepting `/api/chat` in the browser:

```typescript
async function useMSWHandler(page: Page, key: string) {
  await page.evaluate((k) => window.__msw.use(k), key);
}

test('happy path: message → streaming → response', async ({ page }) => {
  await useMSWHandler(page, 'normal');
  await page.goto('/chat');
  await page.fill('textarea', 'Hello');
  await page.press('textarea', 'Enter');
  await expect(page.getByText('Hello world')).toBeVisible();
});
```

The `slow` handler (100 tokens at 100ms intervals) is particularly useful for testing cancellation and auto-scroll — it provides a 10-second streaming window during which Playwright can click Stop, scroll up, and verify the "↓ New content" button behavior.

### A note on the Jest environment

MSW 2.0 requires `fetch`, `Request`, `Response`, and `ReadableStream` to be globally available at module load time. The standard `jsdom` Jest environment doesn't provide these. A custom Jest environment (`jest-environment-with-fetch.js`) injects Node 18's native fetch globals before any test module loads, then delegates everything else to jsdom. This is one of those infrastructure details that's invisible when it works but extremely confusing when it doesn't — so it was built explicitly in T06 alongside the first test that needed it.

---

## React 18 patterns in practice

Phase 1 uses two React 18 features — `startTransition` and automatic batching — and they're both worth examining because they solve real problems that are specific to streaming UI.

### startTransition: keeping the Stop button responsive

The problem: during heavy streaming, 30-50 state updates per second trigger 30-50 re-renders per second. Each render blocks the main thread. If the user clicks Stop during a render, the click event queues behind the render. The UI feels unresponsive.

The solution: wrap the token accumulation state update in `startTransition`. React treats it as interruptible — if a click event arrives mid-render, React can interrupt the token render, process the click, and resume afterward.

This isn't hypothetical. Without `startTransition`, the Stop button has a noticeable delay (20-40ms) during fast streaming. With it, the delay is imperceptible. The difference is the same as the difference between "my click was ignored" and "this app feels instant."

### Automatic batching: atomic message finalization

The problem: when the stream ends, two state updates need to happen simultaneously: `isStreaming` goes to `false` (hiding the live message) and a new entry appears in `history` (showing the finalized message). If these renders happen separately, there's a frame where neither message is visible (flicker) or both are visible (duplication).

The solution: React 18 batches all state updates in the same synchronous context into a single render. When `message_stop` fires:

1. The hook calls `setState({ isStreaming: false })`
2. The hook calls `onComplete`, which calls `setHistory([...prev, finalizedMessage])`

Both calls happen in the same synchronous execution. React batches them into one render. The user sees the streaming message replaced by the finalized message in a single frame.

In React 17, this batching only worked inside React event handlers (like `onClick`). Async contexts — like the `for await` loop inside `useStream.send` — were *not* batched, and each `setState` triggered a separate render. React 18 fixed this by batching everywhere — it's the default behavior, no opt-in required. You don't need to do anything to enable it; the pedagogical value is understanding *that* it happens and *why* it matters for streaming UI. For streaming applications, this is a significant improvement.

---

## Where we ended up

At the end of Phase 1, the M1 milestone is complete. Here's what works:

- **Type a message and see a streaming response.** Tokens appear one by one as the model generates them.
- **Cancel mid-stream.** Click Stop, the fetch aborts, the partial response stays visible.
- **Auto-scroll with manual override.** The chat scrolls to follow new tokens. Scroll up and it pauses. A "↓ New content" button brings you back.
- **TTFT measurement.** Each response shows a time-to-first-token badge.
- **Error handling with retry.** If Ollama is unreachable, the UI shows a clear error message with a Retry button. The `useStream` hook preserves the failed message context so the user can retry without retyping. Abort (user-initiated Stop) is not treated as a retryable failure.
- **Database persistence.** Completed conversations are saved to SQLite (though there's no UI to browse history yet).
- **Full test coverage.** Unit tests for every module, component tests for every component, E2E tests for the four core scenarios (happy path, cancellation, auto-scroll, error).

Here's what's deliberately missing:

- **Markdown rendering.** Responses are plain text. Phase 2 adds `react-markdown` with `useDeferredValue` for streaming-aware rendering.
- **Thinking blocks.** Models that emit `<think>` tags (like DeepSeek-R1) are supported by the protocol but not yet parsed or displayed. Phase 2 adds a state machine in the BFF and a collapsible ThinkingBlock component.
- **Stall detection.** If the model stops producing tokens for 8 seconds, nothing happens. Phase 2 adds a "Still working…" indicator with a Cancel option.
- **Conversation history.** The database stores conversations, but there's no sidebar to browse them. Phase 4 adds the HistoryPane.
- **Settings UI.** The prompt builder supports name and personalization injection, but there's no settings page to configure them. Phase 4 adds it.
- **Observability.** The `message_start` event carries `prompt_used` and `message_stop` carries usage stats, but nothing displays this data yet. Phase 3 adds the ObservabilityPane.

Each of these is a planned extension, and the architecture is ready for all of them. The SSE event protocol already includes thinking events. The database schema already has a `thinking` column. The BFF already emits `prompt_used`. The foundations are laid — Phase 1 just doesn't build on them yet.

---

## What's next

[Phase 2](./PHASE2.md) takes the streaming pipeline from "it works" to "it works well." Thinking block visualization lets you watch the model reason before it responds. Markdown rendering turns plain text into formatted code blocks and lists. Stall detection tells you when the model is stuck and gives you a way out. And `useAutoScroll` gets extracted from the chat page into a reusable, independently-tested hook.

The single-column layout stays — Phase 2 is about streaming quality, not layout. The three-column layout with history and observability panes comes in Phases 3 and 4.
