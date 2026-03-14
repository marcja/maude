# Maude

"Marc's Claude" — a pedagogical LLM chat application that makes front-end streaming patterns visible and exercisable. Every architectural decision is designed to teach how to build a real-time AI assistant UI.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19 (Concurrent Features) |
| Language | TypeScript (strict mode, no `any`) |
| Database | SQLite via better-sqlite3 |
| LLM backend | Ollama (OpenAI-compatible API) |
| Linting/formatting | Biome |
| Unit tests | Jest + MSW 2.0 |
| E2E tests | Playwright + MSW browser worker |
| Styling | Tailwind CSS |
| Markdown | react-markdown + remark-gfm |
| Package manager | pnpm |

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser                                                   │
│                                                            │
│  React Components ──► useStream hook ──► sseParser         │
│  (InputArea,          (fetch, abort,    (ReadableStream    │
│   MessageList,         state machine)    → SSEEvent[])     │
│   MessageItem,                                             │
│   ThinkingBlock,     useStallDetection  useAutoScroll      │
│   StreamingMarkdown,  (8s timeout)       (scroll mgmt)     │
│   StallIndicator,                                          │
│   HistoryPane,       ObservabilityContext                  │
│   ObservabilityPane)  (event bus for debug pane)           │
└─────────────────────────────┬──────────────────────────────┘
                              │ POST /api/chat (SSE)
                              │ GET/DELETE /api/conversations
                              │ GET/PUT /api/settings
┌─────────────────────────────▼──────────────────────────────┐
│  BFF Route (src/app/api/chat/route.ts)                     │
│                                                            │
│  • Reads user settings from SQLite                         │
│  • Composes system prompt via promptBuilder                │
│  • Streams tokens from Ollama via modelAdapter             │
│  • Translates Ollama format → Anthropic-style SSE events   │
│  • Detects <think> tags → emits thinking block events      │
│  • Persists conversation + messages on completion          │
│  • Propagates abort signal to cancel upstream fetch        │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│  Server layer (src/lib/server/)                            │
│                                                            │
│  modelAdapter.ts  — Ollama streaming (only file that       │
│                     reads OLLAMA_BASE_URL / MODEL_NAME)    │
│  promptBuilder.ts — system prompt composition              │
│  db.ts            — SQLite prepared statements             │
│  apiHelpers.ts    — shared JSON response helpers           │
└────────────────────────────────────────────────────────────┘
```

A strict client/server boundary is enforced: no client component may import from `src/lib/server/`. Code is organized under `src/` into `app/` (routes and pages), `components/` (`chat/` and `layout/`), `context/`, `hooks/`, `lib/client/`, `lib/server/`, and `mocks/`.

### Pages

| Route | Description |
|-------|-------------|
| `/` | Welcome page — onboarding entry point with links to chat and settings |
| `/chat` | Three-column chat — history pane, message stream, observability pane |
| `/settings` | User settings — name and personalization prompt (persisted to SQLite) |

### API routes

| Endpoint | Description |
|----------|-------------|
| `POST /api/chat` | SSE streaming — translates Ollama tokens to Anthropic-style events |
| `GET /api/conversations` | List all conversations |
| `GET /api/conversations/[id]` | Load messages for a conversation |
| `DELETE /api/conversations/[id]` | Delete a conversation and its messages |
| `GET /api/settings` | Read user settings |
| `PUT /api/settings` | Update user settings |

## Approach

**BFF streaming translation.** The `/api/chat` route is a thin translator between Ollama's OpenAI-compatible format and Anthropic-style SSE events. The client never knows which LLM backend is running — it only consumes a typed event stream.

**Typed event protocol.** `SSEEvent` is a discriminated union (`message_start`, `content_block_delta`, `error`, etc.) enabling exhaustive type checking across the entire client-side pipeline: parser, hook, and components.

**React 19 concurrent features.** `startTransition` wraps token accumulation so user interactions (e.g. Stop button) are never blocked by rendering. Every concurrent-feature usage has a comment explaining *why* it's needed at that specific call site.

**Single-file model adapter.** `modelAdapter.ts` is the only file that reads `OLLAMA_BASE_URL` or `MODEL_NAME`. Swapping LLM backends means editing one file.

**Observability built in.** An `ObservabilityContext` event bus feeds a collapsible debug pane showing live metrics (TTFT, throughput), a timestamped event log, and the system prompt used for each request. The pane sits alongside the chat in a three-column layout (history | chat | debug).

**Test-driven, Ollama-free.** MSW intercepts `/api/chat` at both layers: Jest unit tests mock at the module level; Playwright E2E tests activate MSW handlers in the browser via string keys. No running model is required to develop or test.

## Getting started

```bash
# Install dependencies
pnpm install

# Configure environment (Ollama must be running locally)
cp .env.example .env.local
# OLLAMA_BASE_URL=http://localhost:11434  (default)
# MODEL_NAME=llama3                       (default)

# Start dev server
pnpm dev

# Open http://localhost:3000/chat
```

## Testing

```bash
# Unit tests (Jest + MSW, no Ollama needed)
pnpm test
pnpm test:coverage

# E2E tests (Playwright, uses MSW browser worker)
pnpm test:e2e

# Type checking
pnpm type-check

# Lint + format
pnpm lint
pnpm lint:fix
```

## Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| M0 | Dev environment setup | Done |
| M1 | Minimal viable chat — streaming, cancellation, auto-scroll | Done |
| M2 | Streaming polish — thinking blocks, markdown, stall detection | Done |
| M3 | Observability — debug pane with metrics, events, system prompt | Done |
| M4 | Full app — history, settings, welcome page, conversation API | Done |

All milestones are complete. See [TASKS.md](TASKS.md) for the detailed build plan and [SPEC.md](SPEC.md) for the full specification.
