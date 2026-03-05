# Maude — Pedagogical LLM Chat App Spec

> **What Maude is.** "Marc's Claude" — a teaching instrument for frontend engineering
> education, not a product. Every architectural decision optimizes for making
> LLM UI concerns visible and exercisable. When in doubt, make the infrastructure
> observable. Comments in code explain *why* a pattern is used, not just *what* it does.

---

## Table of Contents

1. [Development Environment](#1-development-environment)
2. [Tech Stack](#2-tech-stack)
3. [Routes and Application Structure](#3-routes-and-application-structure)
4. [UX Specification](#4-ux-specification)
5. [Architecture](#5-architecture)
6. [React 18 Patterns](#6-react-18-patterns)
7. [Thinking Block Support](#7-thinking-block-support)
8. [Observability Pane](#8-observability-pane)
9. [Test Plan](#9-test-plan)
10. [Git Workflow](#10-git-workflow)
11. [Claude Code Enforcement](#11-claude-code-enforcement)
12. [CLAUDE.md — Constitution and Workflow](#12-claudemd--constitution-and-workflow)
13. [TASKS.md — Task Management](#13-tasksmd--task-management)
14. [Claude Code Operational Notes](#14-claude-code-operational-notes)

---

## 1. Development Environment

### How the pieces fit together

```
Mac Host
├── Claude Code CLI          ← runs here, edits local files directly
├── VSCode                   ← editor, connects INTO the dev container via Dev Containers
│   └── Dev Container ───────────────────────────────────────────────┐
│                            Docker Container                         │
│                            ├── Node LTS runtime                     │
│                            ├── Next.js dev server (port 3000)       │
│                            ├── better-sqlite3 (in-process)          │
│                            └── /workspace → mounted from host ──────┘
└── Ollama                   ← runs natively on Mac host (port 11434)
    └── accessible from container via host.docker.internal:11434
```

**Key point:** Claude Code and the Dev Container are parallel windows into the same
files via volume mount. Claude Code does not run inside Docker. There is no conflict.

### `.devcontainer/devcontainer.json`

```json
{
  "name": "maude",
  "dockerComposeFile": "../docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspace",
  "customizations": {
    "vscode": {
      "extensions": [
        "biomejs.biome",
        "bradlc.vscode-tailwindcss",
        "ms-playwright.playwright"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "biomejs.biome",
        "[typescript]": { "editor.defaultFormatter": "biomejs.biome" },
        "[typescriptreact]": { "editor.defaultFormatter": "biomejs.biome" }
      }
    }
  },
  "postCreateCommand": "pnpm install && pnpm playwright install --with-deps"
}
```

### `docker-compose.yml`

```yaml
services:
  app:
    build:
      context: .
      dockerfile: .devcontainer/Dockerfile
    volumes:
      - .:/workspace:cached
      - ./data:/data
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
    extra_hosts:
      - "host.docker.internal:host-gateway"
    command: sleep infinity
```

### `.devcontainer/Dockerfile`

```dockerfile
FROM mcr.microsoft.com/devcontainers/typescript-node:lts
RUN apt-get update && apt-get install -y sqlite3
```

### `.env.local.example`

```
OLLAMA_BASE_URL=http://host.docker.internal:11434
MODEL_NAME=gpt-oss:20b
```

Copy to `.env.local` and fill in. `.env.local` is gitignored.

### SQLite data directory

The database file lives at `/data/chat.db` inside the container, mapped to `./data/chat.db`
on the host. The `./data/` directory is gitignored except for `.gitkeep`.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14+ App Router | BFF pattern via API routes |
| Language | TypeScript (strict mode) | No `any`, no `as` casts without comment |
| UI | React 18 | See §6 for required patterns |
| Styling | Tailwind CSS | Utility classes only; no component libraries |
| Linting + formatting | Biome | Replaces ESLint + Prettier; single config, ~20x faster |
| Package manager | pnpm | Faster installs, stricter dependency resolution |
| Persistence | better-sqlite3 | Server-side only; never imported by client components |
| Mock layer | MSW 2.0 | Intercepts `POST /api/chat` at network boundary |
| Unit tests | Jest + React Testing Library | |
| Integration tests | Playwright | |
| Markdown | react-markdown + remark-gfm | Streaming-aware usage; see §4 |

---

## 3. Routes and Application Structure

```
/                   Welcome / get-started page
/chat               Main chat interface (history left, content center, observability right)
/settings           User settings page (full page, not modal)
```

### Directory structure

```
src/
  app/
    page.tsx                    # / — welcome page
    chat/
      page.tsx                  # /chat
    settings/
      page.tsx                  # /settings
    api/
      chat/
        route.ts                # POST /api/chat — the BFF
      conversations/
        route.ts                # GET/POST conversations
      conversations/[id]/
        route.ts                # GET/DELETE conversation
      settings/
        route.ts                # GET/PUT user settings
  components/
    chat/
      MessageList.tsx
      MessageItem.tsx
      StreamingMarkdown.tsx
      ThinkingBlock.tsx
      InputArea.tsx
      StallIndicator.tsx
    layout/
      HistoryPane.tsx
      ObservabilityPane.tsx
      ChatLayout.tsx
  lib/
    server/                     # Never imported by client components
      db.ts                     # SQLite connection and queries
      modelAdapter.ts           # Ollama abstraction
      promptBuilder.ts          # System prompt composition
      migrations/
        001_initial.sql
    client/                     # Client-safe utilities
      sseParser.ts              # Parses SSE events from ReadableStream
      metrics.ts                # TTFT, throughput calculations
  hooks/
    useStream.ts                # Core streaming hook
    useStallDetection.ts
    useAutoScroll.ts
    useObservabilityEvents.ts
  context/
    ObservabilityContext.tsx    # In-memory event log
  types/
    events.ts                   # SSE event schema types
    messages.ts
```

---

## 4. UX Specification

### 4.1 Welcome Page (`/`)

A clean landing page analogous to `claude.ai`. Contains:
- App name and one-line description
- "Start chatting" button → navigates to `/chat`
- Brief visual indication of local/private nature (no data leaves the machine)

No functional complexity. This page is intentionally simple.

### 4.2 Chat Interface (`/chat`)

Three-column layout:

```
┌─────────────┬──────────────────────────────┬─────────────────┐
│  History    │        Chat Content          │  Observability  │
│  Pane (L)   │                              │  Pane (R)       │
│  [toggle]   │  Message list                │  [toggle]       │
│             │  ──────────────────────      │                 │
│  Conv list  │  Input area + controls       │  Metrics tab    │
│             │                              │  Events tab     │
│             │                              │  Prompt tab     │
└─────────────┴──────────────────────────────┴─────────────────┘
```

Both side panes are independently collapsible. When collapsed, they show only a narrow
toggle strip. The center content always fills remaining width.

#### Message list

- Scrollable, fills available height
- Auto-scroll behavior (see below)
- Each assistant message shows:
  - Thinking block (collapsible, if present) — appears before response text
  - Response text, rendered with react-markdown incrementally during streaming
  - TTFT badge: e.g. "↯ 312ms" — appears as soon as first token arrives
  - Token throughput: "~47 tok/s" — shown live during streaming, becomes final count on completion
  - A copy icon (triggers `response_copied` observability event)

#### Auto-scroll behavior

- During streaming: scroll to bottom on each token append
- If user scrolls more than 50px above the bottom: suspend auto-scroll
- If user returns within 50px of bottom: resume auto-scroll
- A "↓ New content" button appears at bottom-right when auto-scroll is suspended

#### Input area

- Textarea: grows with content up to 5 lines, then scrolls internally
- Submit: Enter key or button (disabled during streaming)
- Stop button: visible only during streaming; calls `AbortController.abort()`
- New chat button: starts a fresh conversation

#### Cancellation

Clicking Stop calls `AbortController.abort()` on the active fetch. The BFF route
respects `request.signal` — Next.js propagates abort signals to the Ollama fetch.
The UI displays the partial response with a "cancelled" badge. A `stream_cancelled`
event fires in the observability log.

#### Stall detection

If no token arrives for 8 seconds during an active stream, a "Still working…"
indicator appears below the partial response with a Cancel option. The timer resets
on each token. Clears on stream completion or cancellation. Fires `stream_stalled`
observability event.

#### Markdown rendering

Use `react-markdown` with `remark-gfm`. Render incrementally during streaming —
accept that partially-open blocks (code fences, bold spans) look slightly wrong
mid-stream and snap to correct on `message_stop`. Do **not** use "render plain text
then swap to markdown" — the snap to correct rendering on completion is acceptable;
a full content flash-swap is not.

`useDeferredValue` wraps the parsed markdown output to avoid blocking on expensive
re-parses during heavy streaming. See §6.

#### History Pane (left sidebar)

- Conversation list sorted by most-recent-first
- Each entry: auto-generated title (first user message, truncated to 60 chars) + relative timestamp
- Active conversation highlighted
- Hover state reveals a delete (trash) icon with confirmation
- "New chat" at the top
- Clicking a conversation loads full message history into the chat pane
- Loaded context is reconstituted naively: full message history is sent as context
  on the next request (no truncation — pedagogical focus is FE, not context window management)

### 4.3 Settings Page (`/settings`)

Full page (not modal). Two fields, persisted to SQLite:

- **Preferred name** (text input): injected as "The user's name is {name}." in system prompt
- **Personalization prompt** (textarea, max 500 chars): appended to system prompt

Save button writes to SQLite via `PUT /api/settings`. A success toast confirms save.
Changes take effect on the next conversation (not mid-conversation; this simplification
is intentional and commented in promptBuilder.ts).

Link back to `/chat` in the header.

---

## 5. Architecture

### 5.1 BFF Route: `POST /api/chat`

The client never calls Ollama directly. All model interaction goes through this route.

**Request body:**
```typescript
{
  messages: { role: 'user' | 'assistant', content: string }[];
  conversationId: string | null;  // null for new conversation
}
```

**BFF responsibilities (in order):**
1. Read user settings from SQLite (name, personalization prompt)
2. Construct system prompt via `promptBuilder.ts`
3. Call Ollama via `modelAdapter.ts` with `stream: true`
4. Translate Ollama's stream format into the app's SSE schema (see below)
5. Detect `<think>` / `</think>` tags in the token stream; route tokens to correct event type
6. Re-emit as SSE to the client
7. On stream completion (`message_stop`): write completed messages to SQLite
8. On `request.signal` abort: propagate cancellation to the Ollama fetch; do not write partial messages

**SSE event schema** (Anthropic-style — the BFF translates FROM Ollama's format INTO this):

```
data: {"type": "message_start", "message_id": "uuid"}

data: {"type": "thinking_block_start"}
data: {"type": "thinking_delta", "delta": {"text": "Let me consider..."}}
data: {"type": "thinking_block_stop"}

data: {"type": "content_block_start"}
data: {"type": "content_block_delta", "delta": {"text": "Hello"}}
data: {"type": "content_block_delta", "delta": {"text": ","}}
data: {"type": "content_block_stop"}

data: {"type": "message_stop", "usage": {"input_tokens": 42, "output_tokens": 17}}

data: {"type": "error", "error": {"message": "...", "code": "stream_error"}}
```

The client only knows this schema. The choice of Ollama as a backend is invisible to
all client-side code.

### 5.2 Model Adapter (`src/lib/server/modelAdapter.ts`)

Thin abstraction over the Ollama OpenAI-compatible endpoint. Configured entirely via
environment variables. This is the only file that knows `OLLAMA_BASE_URL` or `MODEL_NAME`.

```typescript
// The adapter returns an async iterable of raw token strings.
// Thinking tag detection happens in the BFF route, not the adapter.
export async function streamCompletion(
  messages: ChatMessage[],
  systemPrompt: string,
  signal: AbortSignal
): Promise<AsyncIterable<string>>
```

Swapping backends (e.g., adding a Docker model option later) is a one-file change.

### 5.3 System Prompt Builder (`src/lib/server/promptBuilder.ts`)

```typescript
export function buildSystemPrompt(settings: UserSettings): string {
  const parts = [BASE_SYSTEM_PROMPT];
  if (settings.name) parts.push(`The user's name is ${settings.name}.`);
  if (settings.personalizationPrompt) parts.push(settings.personalizationPrompt);
  return parts.join('\n\n');
}
```

The exact composed prompt is emitted as a `prompt_used` field in the `message_start`
event so the observability pane can display it.

### 5.4 SQLite Schema

```sql
-- migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  thinking TEXT,           -- nullable; stores thinking block content if present
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('name', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('personalizationPrompt', '');
```

Server-side database access is restricted to `src/lib/server/db.ts`. No client
component may import anything from `src/lib/server/`.

### 5.5 Client-Side Streaming (`src/hooks/useStream.ts`)

The core streaming hook. Manages:
- Opening the fetch with `AbortController`
- Reading from `response.body` as a `ReadableStream`
- Parsing SSE events via `sseParser.ts`
- Dispatching to state and observability context
- Cleanup on unmount

```typescript
// Simplified signature
export function useStream(): {
  submit: (messages: ChatMessage[], conversationId: string | null) => void;
  cancel: () => void;
  isStreaming: boolean;
  content: string;
  thinking: string | null;
  metrics: StreamMetrics;
  error: StreamError | null;
}
```

---

## 6. React 18 Patterns

These are **explicit implementation requirements**, not suggestions. Each usage must
include a comment explaining *why* the pattern is used here.

### `startTransition`

Wrap the content state update during token streaming:

```typescript
// startTransition marks this update as non-urgent, allowing the browser
// to prioritize user interactions (Stop button clicks, scroll events)
// over rendering the next token. Without this, heavy streaming can make
// the UI feel unresponsive to user input.
startTransition(() => {
  setContent(contentRef.current);
});
```

### `useDeferredValue`

For the markdown-parsed representation:

```typescript
// Keep the raw string current (updated on every token).
// Defer the expensive markdown parse so React can skip re-parses
// during rapid token arrival and batch them instead.
const rawContent = content;
const deferredContent = useDeferredValue(rawContent);
// Pass deferredContent to <ReactMarkdown> — rawContent to token count display
```

### Automatic batching

React 18 batches all state updates automatically in async contexts. Rely on this.
Do not call `flushSync`. Do not use legacy `unstable_batchedUpdates`. Each SSE
event handler updates state normally.

### Prohibition

Do **not** use `useEffect` to trigger state updates on each token. The stream
reader loop is an async generator — state setters are called directly from it.

---

## 7. Thinking Block Support

Some Ollama models (DeepSeek-R1, QwQ, and others) emit `<think>...</think>` tags
in their output stream. These map directly to Anthropic's `thinking` content block type
and are pedagogically valuable to implement.

### BFF-side detection

The BFF maintains a simple state machine on the token stream:

```
State: TEXT | IN_THINK
- On token containing "<think>": switch to IN_THINK, emit thinking_block_start
- While IN_THINK: emit thinking_delta events
- On token containing "</think>": switch to TEXT, emit thinking_block_stop, emit content_block_start
- Tokens may straddle tag boundaries; buffer as needed
```

This state machine lives in the BFF route, not the model adapter. The adapter
returns raw token strings; the BFF is responsible for semantic parsing.

### Client-side rendering

`<ThinkingBlock>` component:
- Renders as a collapsible disclosure element above the response text
- Header: "Thinking…" (animated pulse while streaming); "Thought for Xs" after completion
- Content: plain text (not markdown), monospace, scrollable, max 200px height
- Collapsed by default; user can expand

If a model does not emit `<think>` tags, `thinking_block_start` is never emitted
and the `ThinkingBlock` component never renders. No configuration required.

---

## 8. Observability Pane

Right sidebar, independently collapsible. Toggle via a the "⚙" button in the header.
Always present in all environments (dev and production). Contains three tabs.

### Pane width constraints

The pane sits in a right sidebar at a fixed width of **300px** when open. All tab
content must be designed for this width. The pane must not introduce horizontal
scrolling. When collapsed, it shows a 32px-wide strip with a vertical "Debug" label
and the toggle button — no content.

Minimum viable open width is 260px; below that, collapse entirely rather than reflow.

### Metrics Tab

Displays the last 10 requests as **cards**, newest first. A full-width table does not
work at pane width — cards allow the data to breathe and remain readable.

Each card layout:

```
┌─────────────────────────────────┐
│ ● completed          14:32:01   │  ← status badge (colored dot) + timestamp
├─────────────────────────────────┤
│ TTFT       Throughput           │
│ 312 ms     47 tok/s             │  ← 2-column grid
│                                 │
│ In         Out        Duration  │
│ 284 tok    163 tok    3.5s      │  ← 3-column grid
└─────────────────────────────────┘
```

Status dot colors: green = completed, amber = stalled, red = error, grey = cancelled.

Cards are compact — no padding waste. Font size for metric values: `text-sm`.
Labels above values: `text-xs text-gray-500`. The timestamp is right-aligned, `text-xs`.

Status values: `completed` / `cancelled` / `error` / `stalled`

### Events Tab

Append-only log, newest at top. Each row is a single line:

```
14:32:01  stream_completed   163 tok, 3.5s
14:31:58  stream_started     312ms TTFT
14:31:57  message_sent       42 chars
```

Three columns: timestamp (`text-xs`, fixed 56px width) + event type (colored badge,
fixed width) + payload (truncated to fit, `text-xs text-gray-600`). Each row is
one line — no wrapping. The entire tab scrolls; no per-row expansion needed.

Event type badge colors:
- Blue: `message_sent`, `conversation_loaded`
- Green: `stream_started`, `stream_completed`, `response_copied`
- Amber: `stream_stalled`, `thinking_started`, `thinking_completed`
- Red: `stream_error`, `stream_cancelled`

Events to instrument:

| Event | Trigger | Payload shown |
|---|---|---|
| `message_sent` | User submits | `{n} chars` |
| `stream_started` | First token | `{ttft}ms TTFT` |
| `thinking_started` | `thinking_block_start` | — |
| `thinking_completed` | `thinking_block_stop` | `{n}ms` |
| `stream_stalled` | 8s no token | `{n}ms elapsed` |
| `stream_cancelled` | User clicked Stop | `{n} tok rcvd` |
| `stream_error` | Error event | `{message}` truncated |
| `stream_completed` | `message_stop` | `{n} tok, {s}s` |
| `response_copied` | Copy clicked | — |
| `conversation_loaded` | History selected | `{n} msgs` |

### System Prompt Tab

A scrollable `<pre>` block showing the exact system prompt sent on the most recent
request. Monospace, `text-xs`, word-wrap enabled, full pane width. Updated on each
`message_start` event (which carries a `prompt_used` field from the BFF).

No truncation — the full prompt is shown. If long, the `<pre>` scrolls internally
(max height: fill remaining pane height).

### State management

Observability state lives in `ObservabilityContext` (React context, in-memory,
not persisted). The context provides `addEvent(event)` and `addMetrics(metrics)`.
Any component can call `addEvent` — it does not need to know about the pane.

---

## 9. Test Plan

**Guiding principle:** No test requires Ollama to be running. MSW intercepts
`POST /api/chat` at the network boundary. All streaming scenarios are reproducible
and deterministic.

### 9.1 MSW Setup

MSW 2.0 with `setupServer` (Jest/Node) and `setupWorker` (Playwright).

**Named handler scenarios** in `src/mocks/handlers/`:

```typescript
// normal.ts
// Emits 20 tokens at 50ms intervals, then message_stop
// Includes 2 thinking tokens before the content block (to exercise ThinkingBlock)

// stall.ts
// Emits 5 tokens, pauses 12 seconds, emits 5 more, then message_stop

// midstream-error.ts
// Emits 10 tokens, then emits error event with code "stream_error"

// truncated.ts
// Emits 8 tokens, then closes stream without message_stop (connection drop simulation)

// slow-ttft.ts
// Waits 3 seconds before first token, then emits normally
// (exercises the "still working" stall indicator with a shorter threshold in test config)
```

Each handler uses MSW 2.0's `HttpResponse` with a `ReadableStream`:

```typescript
import { http, HttpResponse } from 'msw';

export const normalHandler = http.post('/api/chat', () => {
  const stream = new ReadableStream({
    async start(controller) {
      const tokens = ['Hello', ',', ' world', '!', ...];
      controller.enqueue(encode('data: {"type":"message_start",...}\n\n'));
      for (const token of tokens) {
        await delay(50);
        controller.enqueue(encode(`data: {"type":"content_block_delta","delta":{"text":"${token}"}}\n\n`));
      }
      controller.enqueue(encode('data: {"type":"message_stop",...}\n\n'));
      controller.close();
    }
  });
  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
});
```

### 9.2 Unit Tests (Jest + React Testing Library)

**`sseParser.ts`**
- Correctly parses single-event chunks
- Correctly parses multi-event chunks (multiple `data:` lines in one read)
- Handles partial chunks split across reads (chunk boundary mid-event)
- Handles `message_stop` terminator

**`useStream` hook**
- Token accumulation: given a sequence of `content_block_delta` events, content state accumulates correctly
- TTFT: timestamp between `message_sent` and first `content_block_delta` is recorded correctly
- Thinking block state: `thinking` state populates during `thinking_delta` events, freezes on `thinking_block_stop`
- Cancellation: `cancel()` aborts the controller; `isStreaming` becomes false; content preserved

**`useStallDetection` hook**
- Fires callback after 8000ms of no token
- Resets timer correctly on token arrival
- Does not fire after stream completes

**`useAutoScroll` hook**
- Auto-scrolls to bottom when `isStreaming` is true and user is near bottom
- Suspends when user scrolls more than 50px above bottom
- Resumes when user returns within 50px of bottom

**`promptBuilder.ts`**
- Empty name: system prompt contains only base + personalization
- Name set: prompt contains name injection string
- Both set: prompt contains both in correct order
- Empty personalization: no trailing whitespace/newlines in output

**`ThinkingBlock` component**
- Renders collapsed by default
- Expands on click
- Shows "Thinking…" label while `isStreaming` is true
- Shows "Thought for Xs" label after streaming completes

**Conversation title generation**
- First message under 60 chars: used verbatim
- First message over 60 chars: truncated with ellipsis

### 9.3 Integration Tests (Playwright)

Each test uses a Playwright fixture that starts MSW's `setupWorker` with the
appropriate handler before navigating to `/chat`.

**Happy path — normal handler**
- Submit message → tokens stream in → TTFT badge appears on first token
- Throughput shown live during streaming
- ThinkingBlock appears (collapsed), shows duration after completion
- `message_stop` received → streaming ends → final token count shown
- Message appears in history pane with auto-generated title

**Cancellation**
- Submit message (normal handler) → click Stop after 3 tokens
- Partial response shown with "cancelled" badge
- Observability Events tab shows `stream_cancelled` event
- No further tokens arrive after cancellation
- Input area re-enables

**Stall detection — stall handler**
- Submit message → first 5 tokens arrive → "Still working…" indicator appears after 8s
- Cancel button visible in stall indicator
- Click Cancel → cancelled state shown
- Observability Events tab shows `stream_stalled` then `stream_cancelled`

**Mid-stream error — midstream-error handler**
- 10 tokens arrive → error event received
- Partial response shown
- Error recovery UI: "Something went wrong — Retry?"
- Click Retry → new request starts (verify new `message_sent` event in observability)

**Auto-scroll**
- Normal handler with 40+ tokens (long response)
- Verify page scrolls to bottom as tokens arrive
- Scroll up manually during streaming → auto-scroll suspends
- "↓ New content" button appears
- Click button → returns to bottom → auto-scroll resumes

**Settings injection**
- Navigate to `/settings` → enter name "Alice" and personalization "Be concise." → Save
- Navigate to `/chat` → submit message
- Open observability pane → System Prompt tab shows "The user's name is Alice." and "Be concise."

**History loading**
- Complete a conversation (normal handler)
- Click that conversation in the history pane
- Verify all prior messages render
- Submit a new message
- Inspect the request body via Playwright's `page.route` intercept: prior messages are included as context

**Observability pane**
- Complete two conversations
- Open debug pane → Metrics tab shows two rows with correct TTFT and status
- Events tab shows complete event sequence for most recent conversation
- Copy an assistant message → `response_copied` event appears in Events tab

---

## 10. Git Workflow

This section is a concise reference. The authoritative version lives in CLAUDE.md
and Claude Code should treat CLAUDE.md as the source of truth after project init.

### Pre-commit gate (all must pass — no suppressions)

```bash
pnpm type-check    # zero TypeScript errors
pnpm lint          # zero Biome errors or warnings
pnpm test          # all unit tests pass
pnpm test:coverage # coverage does not decrease
```

Plus manual checks: no `any` without comment, no dead code, no redundant logic,
no `console.log` outside ObservabilityContext, no commented-out code, no magic literals.

### Commit message structure

```
<type>(<scope>): <imperative summary, max 72 chars>

Goal:        what problem this solves or capability it adds
Approach:    key technical decisions and why
Accomplished: bullet list of what is now true
Gaps & improvements: known limitations or edge cases not handled
Next steps:  what follows and why it depends on this commit
```

Types: `feat` / `fix` / `test` / `refactor` / `docs` / `chore`

Scope: task ID or module name — e.g., `feat(T04)`, `refactor(sseParser)`

### Post-commit refactoring analysis

After every commit, inspect the diff for: unnecessary length, mixed responsibilities,
duplication, unclear naming, or low testability. If any issue is found, create a
`refactor()` task and complete it before the next feature task. Note the outcome
(actions taken or "no actions identified") in TASKS.md.

Refactoring commits change structure only — behavior and tests are unchanged.
If a test must change during a refactor, it was testing implementation; fix the
test in the same commit and explain why in the commit message.

---

## 11. Claude Code Enforcement

CLAUDE.md describes *what* the rules are. This section specifies *how they are
mechanically enforced* through git hooks, Claude Code hooks, and Skills.

### How the mechanisms fit together

**Skills** (`SKILL.md` files in `.claude/skills/`) are the primary extension point.
From the current docs: *"Custom commands have been merged into skills."* A file at
`.claude/commands/review.md` and `.claude/skills/review/SKILL.md` both create `/review`
and work the same way. Skills add supporting files, frontmatter, and invocation control.

Skills have two invocation dimensions controlled by frontmatter. The third column
matters: `disable-model-invocation: true` removes the description from Claude's
context entirely, so Claude doesn't know the skill exists until you invoke it.
`user-invocable: false` keeps the description in context so Claude can decide to
invoke it, but hides it from the `/` menu.

| Frontmatter | You can invoke | Claude can invoke | Description in context? |
|---|---|---|---|
| (default) | Yes (`/skill-name`) | Yes (auto, from description) | Always |
| `disable-model-invocation: true` | Yes | **No** | **Never** — Claude doesn't see it |
| `user-invocable: false` | **No** | Yes | Always |

Skills can also run in an isolated context via `context: fork`, optionally specifying
which agent type (`Explore`, `Plan`, `general-purpose`, or a custom agent name).
**Warning from the docs:** "`context: fork` only makes sense for skills with explicit
instructions." If your skill contains passive guidelines rather than a task, the
forked agent returns without meaningful output.

**`/simplify` is a bundled skill** — ships with Claude Code, available in every
session without any configuration. It spawns three parallel review agents (code reuse,
code quality, efficiency), aggregates their findings, and applies fixes. Use it after
completing a feature or after a post-commit analysis suggests cleanup is needed. Our
project adds *constraints* on top of `/simplify` via the CLAUDE.md constitution
(don't add behavior, run tests before and after) rather than reimplementing it.

**Hooks** (`PreToolUse` / `PostToolUse`) are bash scripts fired on tool events. They
are the hard gates — they run at the Claude Code layer before any skill or agent can
interfere.

**Git `pre-commit` hook** is the OS-level backstop that cannot be bypassed without
`--no-verify`, which is prohibited.

### Layer 1: git `pre-commit` hook (OS-level, unbypassable)

Located at `.git/hooks/pre-commit`. Runs regardless of Claude Code, skills, or hooks.

```bash
#!/usr/bin/env bash
set -e
pnpm type-check
pnpm lint
pnpm test --passWithNoTests
pnpm test:coverage --passWithNoTests
echo "✓ Pre-commit gate passed"
```

`scripts/install-hooks.sh` installs it and is committed to the repo. The dev
container's `postCreateCommand` runs it automatically.

### Layer 2: Claude Code hooks (in `.claude/settings.json`)

Three hooks work together:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/check-commit.sh" }]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/check-tasks-write.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/post-commit.sh" }]
      }
    ]
  },
  "rules": [
    "Never use --no-verify with git commit",
    "Never import from src/lib/server/ in a client component",
    "Always use pnpm, never npm or yarn",
    "Always use biome for linting and formatting; never ESLint or Prettier"
  ]
}
```

**`check-commit.sh`** — `PreToolUse` on Bash: intercepts `git commit`, runs
`pnpm type-check && pnpm lint && pnpm test`. Exits non-zero on failure, giving
Claude Code a chance to self-correct before the OS-level hook blocks it.

**`check-tasks-write.sh`** — `PreToolUse` on Write/Edit: intercepts writes to
`TASKS.md`, extracts new content to a tempfile, runs `validate_tasks.py`. Rejects
the write and reports the violation if validation fails.

**`post-commit.sh`** — `PostToolUse` on Bash: detects a successful `git commit`
and emits `MAUDE_POST_COMMIT_REQUIRED=1` to stdout. Claude Code reads this as a
context signal to invoke the `analyze-refactoring` skill before the next task.

All hook scripts and `validate_tasks.py` live in `.claude/hooks/` and are committed.

`validate_tasks.py` checks: required sections present, task IDs sequential and
unique, status values from allowed set, Depends: references resolve, milestone
headings match the spec, no sections removed.

### Layer 3: Skills (in `.claude/skills/`)

Three project skills. Two use `disable-model-invocation: true` or `user-invocable:
false` to control whether users or Claude trigger them.

**`.claude/skills/run-pre-commit-check/SKILL.md`**

`disable-model-invocation: true` — you invoke this manually with `/run-pre-commit-check`
before committing. Claude must not decide unilaterally to run the full test suite.

```yaml
---
name: run-pre-commit-check
description: Run the full pre-commit quality gate before committing. Invoke
  manually before any git commit to catch failures before the OS hook blocks
  the commit.
disable-model-invocation: true
allowed-tools: Bash
---

# Run Pre-Commit Check

Run in sequence. Stop on the first failure and report the exact error output.

1. `pnpm type-check` — zero TypeScript errors
2. `pnpm lint` — zero Biome errors or warnings
3. `pnpm test` — all tests pass
4. `pnpm test:coverage` — coverage has not decreased

Only proceed to `git commit` when all four exit 0.
Fix all failures before retrying. Do not suppress errors.
```

**`.claude/skills/validate-tasks-edit/SKILL.md`**

`user-invocable: false` — Claude invokes this; it never appears in the `/` menu.
Its description is always in Claude's context, so when Claude considers editing
TASKS.md it sees the skill and knows to run validation first. This is the **soft
layer**: it gives Claude upfront awareness so it prepares valid content before
attempting a write. The `check-tasks-write.sh` hook is the **hard layer**: it
intercepts the Write/Edit tool call and rejects structurally invalid content
regardless of whether the skill was consulted. Both layers are needed — the
skill prevents violations; the hook catches any that slip through.

```yaml
---
name: validate-tasks-edit
description: Validate TASKS.md structure before saving any edit. Use before
  writing to TASKS.md to prevent structural corruption — missing sections,
  invalid task IDs, broken Depends references, or removed tasks.
user-invocable: false
allowed-tools: Read, Bash
---

# Validate Tasks Edit

Before saving any edit to TASKS.md, run:

```bash
python3 .claude/hooks/validate_tasks.py TASKS.md
```

If it exits non-zero, report the specific violation and do not save the edit.

Checks performed:
- Required sections present (Status legend + Phase sections with milestones)
- Status legend text unchanged
- No existing sections or tasks deleted
- Task IDs in T## format, sequential with no gaps, unique
- Statuses only from the allowed set: [ ] [~] [x] [!]
- All Depends: references resolve to real task IDs in the file
- Blocked tasks ([!]) include a note explaining the blocker
```

**`.claude/skills/analyze-refactoring/SKILL.md`**

`context: fork` with `agent: Explore` — runs in an isolated, read-only context
(Glob, Grep, Read, and read-only Bash: git diff, cat, etc.). `user-invocable: false`
hides it from the `/` menu but keeps its description in Claude's context. The
`post-commit.sh` hook emits `MAUDE_POST_COMMIT_REQUIRED=1` to stdout after a
successful commit; Claude Code injects this into context, and Claude — which
already knows about this skill from its description — connects the signal and
invokes it. This is a soft trigger: the hook signals intent; Claude acts on it.

```yaml
---
name: analyze-refactoring
description: Analyze the most recent git commit for refactoring opportunities.
  Invoked automatically after every commit. Examines the diff for mixed
  responsibilities, duplication, unclear naming, unnecessary length, or low
  testability. Returns actionable refactoring tasks or confirms none needed.
context: fork
agent: Explore
user-invocable: false
---

Analyze the most recent commit for refactoring opportunities.

1. Run `git diff HEAD~1 HEAD --name-only` to get changed files
2. Run `git diff HEAD~1 HEAD` to read the full diff
3. Read the current version of each changed file

Analyze for:
- **Mixed responsibilities**: Any function or component doing more than one thing?
- **Duplication**: Same logic appearing 2+ times? (2x = candidate; 3x = mandatory)
- **Unnecessary length**: Anything longer than it needs to be?
- **Unclear naming**: Names that could be clearer?
- **Low testability**: Structure that makes testing harder than necessary?

Output — choose exactly one format:

If improvements found:
  List each as: `refactor(<scope>): <description>` — file: <path>, lines: <range>

If none found:
  `Refactoring analysis: no actions identified`

Read only. Do not modify files.
```

### Bundled skill: `/simplify`

`/simplify` ships with Claude Code and requires no project configuration. Run it
after completing a task or when post-commit analysis suggests cleanup. It spawns
three parallel review agents (code reuse, code quality, efficiency), aggregates
their findings, and applies fixes.

Project-specific constraints from CLAUDE.md apply during any simplification:
tests must pass before and after, no new behavior, no bug fixes mixed in.

Invoke after committing a task: `/simplify` or `/simplify focus on <specific concern>`.

### Enforcement file layout

```
.claude/
  settings.json
  hooks/
    check-commit.sh
    check-tasks-write.sh
    post-commit.sh
    validate_tasks.py
  skills/
    run-pre-commit-check/SKILL.md   ← disable-model-invocation; user runs manually
    validate-tasks-edit/SKILL.md    ← user-invocable: false; Claude runs before edits
    analyze-refactoring/SKILL.md    ← context: fork; Claude runs after commits
scripts/
  install-hooks.sh
  pre-commit.sh
```

Note: `.claude/agents/` directory is not used. The `analyze-refactoring` subagent
behavior is implemented as a skill with `context: fork` — same isolation, fewer
moving parts, consistent with the skills-first architecture.

---

## 12. CLAUDE.md — Constitution and Workflow

Create this file at the project root. Claude Code reads it at the start of every session.
Update it when architectural decisions change — note the change in the commit message as
`docs(CLAUDE.md): <reason>`. Remove stale sections rather than letting them accumulate.

```markdown
# CLAUDE.md — Project Constitution

## What Maude is

"Marc's Claude" — a pedagogical LLM chat application for learning to design and
build a streaming LLM-based AI assistant. Every architectural decision optimizes for making LLM UI
concerns visible and exercisable. Comments explain *why*, not just *what*.

## Enforcement — do not bypass

Hard gates run automatically. Do not use `--no-verify`. Do not suppress lint errors.

- Git pre-commit hook blocks commits that fail type-check, lint, or tests
- Claude Code PreToolUse hooks intercept `git commit` and TASKS.md writes
- Claude Code PostToolUse hook signals that `analyze-refactoring` subagent must
  run after every commit before the next task begins
- `run-pre-commit-check` skill activates automatically before commit attempts
- `validate-tasks-edit` skill activates automatically before TASKS.md edits

## Non-negotiable constraints

- TypeScript strict mode. No `any`. No `as` casts without an explanatory comment.
- No client component may import from `src/lib/server/`.
- All `startTransition` and `useDeferredValue` usages must have comments explaining
  why they are needed at that specific location.
- The model adapter is the only file that references `OLLAMA_BASE_URL` or `MODEL_NAME`.
- MSW intercepts `/api/chat`. No test requires Ollama to be running.
- Always use `pnpm`. Never `npm` or `yarn`.
- Always use `biome` for linting and formatting. No ESLint. No Prettier.

## TDD workflow — mandatory for every task

1. Read the task definition in TASKS.md
2. Write failing tests that specify the behavior
3. Implement the minimum code to make tests pass
4. Run `run-pre-commit-check` skill (or `pnpm type-check && pnpm lint && pnpm test`)
5. Run Playwright tests if the task touches UI behavior
6. Self-review every changed file before committing
7. Commit (one commit per task)
8. After commit: invoke `analyze-refactoring` subagent; act on its output before
   the next task
9. Mark task done in TASKS.md; update milestone status if applicable

## Self-review checklist (before every commit)

- [ ] Implementation matches the SPEC.md definition for this task
- [ ] Each function/hook/component does one thing
- [ ] Comments explain *why*, not *what*
- [ ] `startTransition`/`useDeferredValue` usages are commented with specific reasons
- [ ] No client component imports from `src/lib/server/`
- [ ] Error paths are handled explicitly, not silently swallowed
- [ ] Change is the smallest complete working increment

## Commit message format

```
<type>(<scope>): <imperative summary, max 72 chars>

Goal:        what problem this solves or capability it adds
Approach:    key technical decisions and why
Accomplished: bullet list of what is now true
Gaps:        known limitations (or "None known")
Next steps:  what follows and why it depends on this commit
```

Types: `feat` / `fix` / `test` / `refactor` / `docs` / `chore`
Scope: task ID or module — `feat(T05)`, `refactor(sseParser)`, `docs(CLAUDE.md)`

## Post-commit refactoring

After every commit, the `analyze-refactoring` subagent runs automatically via
the PostToolUse hook. If it identifies improvements, create a `refactor(<scope>)`
task in TASKS.md and complete it before the next feature task. Refactoring commits
change structure only — behavior and tests are unchanged before and after.

## Subagent coordination

When using the Task tool to spawn subagents:
- Each subagent receives its task ID, the relevant SPEC.md section, and the
  TypeScript interface contracts it depends on
- Each subagent updates TASKS.md status fields when complete
- Subagents do not modify CLAUDE.md or TASKS.md structure — only status fields
```

---

## 13. TASKS.md — Task Management

Create this file at the project root. Claude Code maintains it throughout the build.
Do not delete completed tasks — they serve as a build history.

**Milestone philosophy:** Every phase ends with a demonstrable, runnable application.
Each task annotation shows what user-facing value it enables or advances toward.
Integration (Playwright) tests are included in the phase that introduces the behavior —
not deferred to a final phase.

```markdown
# TASKS.md — Maude Build Plan

## Status legend
- `[ ]` todo
- `[~]` in-progress
- `[x]` done
- `[!]` blocked (note reason)

## Milestone overview

| Milestone | Phase | What you can demo |
|---|---|---|
| M0: Dev ready | Phase 0 | Container starts, tooling works, hooks enforced |
| M1: Minimal viable chat | Phase 1 | Type a message, see a streaming response |
| M2: Streaming polish | Phase 2 | Cancellation, stall detection, thinking blocks, rich markdown |
| M3: Observability | Phase 3 | Debug pane shows live metrics, events, system prompt |
| M4: Full app | Phase 4 | History, settings, welcome page, complete navigation |

---

## Phase 0 — Dev Ready
**Milestone M0:** Container starts; `pnpm install`, `pnpm type-check`, `pnpm lint`
all pass on empty src; git pre-commit hook installed; skills and subagent scaffolded.

- [ ] T00 — Project skeleton, enforcement infrastructure, and dev container
      User value: development environment is fully operational; all quality
        gates are in place before any feature work begins
      Deliverable: `package.json` (pnpm + Biome + Jest + Playwright), `tsconfig.json`,
        `biome.json`, `CLAUDE.md`, `TASKS.md`, `.gitignore`, `.devcontainer/`,
        `docker-compose.yml`, `scripts/install-hooks.sh`, `scripts/pre-commit.sh`,
        `.claude/settings.json`, `.claude/hooks/` (all four files),
        `.claude/skills/` (three skills), `.claude/agents/analyze-refactoring.md`
      Test: `pnpm install` succeeds; `pnpm type-check` and `pnpm lint` run cleanly
        on empty src; git pre-commit hook blocks a deliberately failing commit;
        `validate_tasks.py TASKS.md` exits 0; container starts, port 3000 reachable,
        host.docker.internal resolves

---

## Phase 1 — Minimum Viable Chat
**Milestone M1:** The app runs. A user types a message and sees a streaming response.
Single-column layout; no history pane, no observability pane yet. This is the
end-to-end slice that proves the streaming pipeline works.

- [ ] T01 — SQLite schema and migration runner
      User value: prerequisite for BFF to persist messages; also needed by T09
      Deliverable: `migrations/001_initial.sql`, `src/lib/server/db.ts`
      Test: migration runs cleanly; tables exist; default settings inserted

- [ ] T02 — Model adapter (Ollama)
      User value: prerequisite for BFF to reach the model
      Deliverable: `src/lib/server/modelAdapter.ts`
      Test: unit test with mocked fetch; correct headers, `stream: true`,
        signal propagation, `model_unreachable` error on connection failure

- [ ] T03 — SSE parser utility
      User value: prerequisite for client to consume the token stream
      Deliverable: `src/lib/client/sseParser.ts`
      Test: partial chunks, multi-event chunks, message_stop, error events

- [ ] T04 — Prompt builder
      User value: prerequisite for BFF to construct system prompt from settings
      Deliverable: `src/lib/server/promptBuilder.ts`
      Test: base prompt assembled; name injection; personalization injection;
        empty settings produce clean base prompt

- [ ] T05 — BFF route: happy path streaming
      User value: first end-to-end token flow from Ollama to HTTP response
      Deliverable: `src/app/api/chat/route.ts` (basic SSE emission, no abort yet)
      Depends: T01, T02, T04
      Test: MSW normal handler; event sequence (message_start → deltas →
        message_stop) reaches client; prompt_used field present in message_start

- [ ] T06 — useStream hook (minimal)
      User value: React hook that drives the streaming UI; wires SSE to state
      Deliverable: `src/hooks/useStream.ts`
      Depends: T03
      Test: token accumulation; TTFT recorded; message_stop finalizes;
        error event sets error state; abort controller wired to Stop action

- [ ] T07 — MessageItem component
      User value: renders a single chat message (user or assistant)
      Deliverable: `src/components/MessageItem.tsx`
      Test: renders user message; renders assistant message with TTFT badge;
        copy button present; streaming state shows spinner

- [ ] T08 — InputArea component
      User value: the input bar — submit, Stop button, keyboard shortcuts
      Deliverable: `src/components/InputArea.tsx`
      Test: submit fires on Enter; Shift+Enter inserts newline; Stop button
        visible during streaming only; disabled when empty

- [ ] T09 — BFF route: abort signal propagation + SQLite write
      User value: cancellation works end-to-end; completed messages are persisted
      Deliverable: updates to `src/app/api/chat/route.ts`
      Depends: T05, T01
      Test: abort mid-stream cancels Ollama fetch and writes no DB row;
        completed stream writes conversation + messages to DB with title

- [ ] T10 — Minimal chat page (single-column)
      User value: **M1 milestone** — app is runnable; type a message, see streaming
      Deliverable: `src/app/chat/page.tsx` (no history pane, no debug pane;
        MessageList + InputArea wired to useStream; minimal layout)
      Depends: T06, T07, T08
      Test (Playwright — M1 suite):
        • Happy path: message sent → tokens stream → message_stop → response shown
        • Cancellation: Stop clicked mid-stream → partial response shown
        • Auto-scroll: long response scrolls to bottom; manual scroll suspends;
          "↓ New content" button returns to bottom
        • Ollama unreachable: clear error message shown (not a generic 500)

---

## Phase 2 — Streaming Polish
**Milestone M2:** All production streaming behaviors work. Cancellation, stall
detection, thinking blocks, rich markdown rendering. The app handles failure modes
gracefully. No new layout — same single-column chat, but battle-hardened.

- [ ] T11 — BFF route: thinking block detection
      User value: reasoning-trace models (DeepSeek-R1, QwQ) show their thinking
      Deliverable: state machine in `route.ts` for `<think>` tag parsing
      Depends: T05
      Test: unit test with token sequences that straddle tag boundaries;
        thinking_block_start / delta / stop events emitted correctly

- [ ] T12 — ThinkingBlock component
      User value: collapsible "Thought for Xs" disclosure above response text
      Deliverable: `src/components/ThinkingBlock.tsx`
      Test: collapsed by default; expands on click; "Thinking…" during stream;
        "Thought for Xs" on completion; never renders if no thinking events

- [ ] T13 — StreamingMarkdown component
      User value: rich markdown rendering during and after streaming
      Deliverable: `src/components/StreamingMarkdown.tsx`
      Depends: T06
      Test: partial markdown renders without throwing; code fence snaps to
        correct render on close; upgrade from plain text in MessageItem

- [ ] T14 — useStallDetection hook
      User value: detects when the model stops producing tokens for 8 seconds
      Deliverable: `src/hooks/useStallDetection.ts`
      Test: timer fires after 8s with no token; resets on each token arrival;
        clears on stream end

- [ ] T15 — Stall indicator component
      User value: "Still working…" UI with Cancel option during stalls
      Deliverable: `src/components/StallIndicator.tsx`
      Depends: T14
      Test: renders after stall; Cancel fires abort; disappears on token arrival

- [ ] T16 — useAutoScroll hook (extracted from T10)
      User value: correct scroll behavior as a reusable, tested hook
      Deliverable: `src/hooks/useAutoScroll.ts`
      Test: scrolls to bottom during streaming; suspends if user scrolls >50px
        up; resumes on return to bottom; "↓ New content" button state

- [ ] T17 — Wire Phase 2 components into chat page
      User value: **M2 milestone** — full streaming behavior in the running app
      Deliverable: update `chat/page.tsx` to use ThinkingBlock, StreamingMarkdown,
        StallIndicator, useAutoScroll
      Depends: T11–T16
      Test (Playwright — M2 suite):
        • Stall detection: 5 tokens → 8s pause → "Still working…" appears → Cancel
        • Mid-stream error: 10 tokens → error event → partial + "Retry?" shown
        • Thinking blocks: thinking handler → ThinkingBlock renders + collapses
        • Markdown: code block renders correctly during and after streaming

---

## Phase 3 — Observability
**Milestone M3:** The debug pane is visible and live. Metrics cards, event log,
and system prompt tab make the streaming infrastructure teachable and inspectable.

- [ ] T18 — ObservabilityContext
      User value: cross-cutting event bus; enables any component to emit to
        the debug pane without coupling to it
      Deliverable: `src/context/ObservabilityContext.tsx`
      Test: addEvent stores events; addMetrics stores metrics;
        context accessible in child components

- [ ] T19 — Wire useStream to ObservabilityContext
      User value: streaming events (TTFT, throughput, errors) now flow to debug pane
      Deliverable: update `src/hooks/useStream.ts`
      Depends: T18, T06
      Test: TTFT emitted on first token; stream_completed emitted on message_stop;
        stream_cancelled emitted on abort; stream_error emitted on error event

- [ ] T20 — ObservabilityPane component
      User value: debug pane with Metrics cards, Events log, System Prompt tab
      Deliverable: `src/components/ObservabilityPane.tsx`
      Depends: T18
      Test: Metrics tab shows last 10 requests as cards; Events tab shows log
        newest-first; System Prompt tab shows last prompt_used value;
        pane collapses to 32px strip with "Debug" label

- [ ] T21 — Three-column layout: center + right pane
      User value: **M3 milestone** — debug pane visible alongside chat
      Deliverable: update `chat/page.tsx` to add right-side ObservabilityPane;
        toggle via "⚙" button; center fills remaining width
      Depends: T19, T20
      Test (Playwright — M3 suite):
        • Observability pane: two conversations → Metrics shows two cards;
          Events shows complete sequence; copy button → response_copied appears
        • System Prompt tab: name "Alice" set in settings → prompt shows it
        • Pane collapses and expands; center fills width when collapsed

---

## Phase 4 — Full App
**Milestone M4:** Complete application. Conversation history, settings, welcome
page, full three-column layout with history pane on the left.

- [ ] T22 — History pane component
      User value: browse and reload past conversations
      Deliverable: `src/components/HistoryPane.tsx`
      Depends: T01
      Test: loads conversations from API; click restores all messages; delete
        with confirmation; new conversation starts fresh; pane collapses

- [ ] T23 — Full three-column layout
      User value: **M4 partial** — history + chat + observability all visible
      Deliverable: update `chat/page.tsx` to add left HistoryPane; all three
        columns present; each pane independently collapsible
      Depends: T21, T22
      Test (Playwright — M4 suite):
        • History loading: complete conversation → reload → prior messages shown;
          new message sent → request body contains prior messages as context
        • Both panes collapse/expand; center fills available width

- [ ] T24 — Settings page
      User value: user can set their name and personalization prompt
      Deliverable: `src/app/settings/page.tsx`
      Depends: T01
      Test: loads settings from API; save writes to DB; success feedback shown;
        saved values persist on reload

- [ ] T25 — Welcome page
      User value: proper entry point; onboarding for new users
      Deliverable: `src/app/page.tsx`
      Test: "Start chatting" navigates to /chat; settings link navigates to /settings
      Test (Playwright): settings injection end-to-end — set name → chat →
        System Prompt tab shows name injected

- [ ] T26 — Conversation API routes
      User value: history pane can load, create, and delete conversations
      Deliverable: `src/app/api/conversations/route.ts`,
        `src/app/api/conversations/[id]/route.ts`
      Depends: T01
      Test: GET returns conversation list; DELETE removes conversation and messages;
        GET /[id] returns messages for a conversation
```

---

## 14. Claude Code Operational Notes

These notes are for Claude Code and should also appear in `CLAUDE.md`.

**Build order is milestone-driven.** The goal of each phase is a runnable application,
not a complete layer. Phase 1 builds the minimal end-to-end slice — BFF + streaming
hook + minimal UI — before any polish. Do not build all components and then wire them.

**Playwright tests belong to the phase that introduces the behavior.** Each milestone
includes its own E2E test suite. Tests added at M1 remain green through M2, M3, M4.
A regression at any phase is a blocker before the next task proceeds.

**MSW handlers are test infrastructure.** Build the MSW handlers (normal, stall,
midstream-error, truncated, slow-ttft) as part of T05. Every subsequent test task
depends on them.

**ObservabilityContext is wired in Phase 3, not Phase 1.** The streaming hook works
without it in Phase 1 and Phase 2. Context is added in T19 as an upgrade, not a
prerequisite. This keeps Phase 1 focused.

**Server/client boundary is strict.** If TypeScript reports an error about importing
server code in a client component, move the import. Do not remove `'use server'`.
The boundary mirrors real Anthropic architecture and is pedagogically intentional.

**When Ollama is unreachable,** the app must show a clear error in the chat area
("Could not reach local model — is Ollama running?"), not a generic 500. This is
tested in the M1 Playwright suite.

**Use pnpm exclusively.** Never `npm` or `yarn`. Lockfile is `pnpm-lock.yaml`.

**Biome replaces ESLint and Prettier.** `pnpm lint` for both. `pnpm lint:fix` to
auto-fix. Do not install or configure ESLint or Prettier.

**Do not install component libraries.** Tailwind utility classes only. If a UI
pattern is complex to implement in Tailwind, that complexity is the point.
