# Maude v1.0 — As-Built Specification

> Generated 2026-03-15 from codebase analysis. Cross-references original SPEC.md.

---

## 1. Overview

Maude ("Marc's Claude") is a pedagogical LLM chat application built to make
streaming UI infrastructure visible and exercisable. It is a teaching instrument,
not a product. Every architectural decision optimizes for learnability.

**Stack:** Next.js 16 + React 19 + TypeScript strict + Tailwind CSS 3 +
better-sqlite3 + Ollama + Biome + Jest + MSW 2 + Playwright

---

## 2. Application Structure

### Routes

| Path | Type | Purpose |
|------|------|---------|
| `/` | Server component | Welcome page with nav to `/chat` and `/settings` |
| `/chat` | Server component | Pre-fetches conversation list, renders `ChatShell` client component |
| `/chat/[id]` | Server component | Pre-fetches conversation + messages, hydrates `ChatShell` |
| `/settings` | Server component | Pre-fetches settings from SQLite, renders `SettingsForm` client component |

### API Routes

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/chat` | POST | BFF streaming endpoint; SSE response with typed events |
| `/api/conversations` | GET | List conversations ordered by `updated_at DESC` |
| `/api/conversations/[id]` | GET, DELETE | Fetch messages or delete conversation (cascade) |
| `/api/settings` | GET, POST | Read/write user settings |

---

## 3. Architecture

### Server Libraries (`src/lib/server/`)

| Module | Responsibility |
|--------|---------------|
| `db.ts` | SQLite access layer via better-sqlite3 (synchronous). Factory pattern (`createDatabase`) for test isolation with `:memory:`. Prepared statements cached. `server-only` guard. |
| `modelAdapter.ts` | Sole Ollama integration point. Reads `OLLAMA_BASE_URL` and `MODEL_NAME` env vars. Returns `AsyncIterable<string>` token stream. Handles reasoning content by wrapping in `<think>` tags. Typed errors: `model_unreachable`, `bad_response`. |
| `promptBuilder.ts` | Pure function assembling system prompt from base template + user settings. |
| `apiHelpers.ts` | Shared `ValidationError` class and `jsonResponse()` helper for route handlers. |

### BFF Route (`/api/chat`)

The central hub. Key behaviors:
- **Streaming:** Push-based `ReadableStream` with SSE wire format (`data: <json>\n\n`)
- **Thinking-tag state machine:** Parses `<think>`/`</think>` across token boundaries in `processBuffer()`
- **Abort propagation:** HTTP request signal forwarded to Ollama fetch
- **Persistence:** Writes conversation + messages to SQLite only on successful completion
- **Error semantics:** Always returns HTTP 200 (SSE requirement); errors sent as typed events

### SSE Event Schema

Discriminated union inspired by Anthropic Messages API (`src/lib/client/events.ts`):

| Event | Payload |
|-------|---------|
| `message_start` | `message_id`, `prompt_used?` |
| `thinking_block_start/stop` | — |
| `thinking_delta` | `delta.text` |
| `content_block_start/stop` | — |
| `content_block_delta` | `delta.text` |
| `message_stop` | `conversation_id`, `usage` |
| `error` | `error.message`, `error.code` |

### Client Libraries (`src/lib/client/`)

| Module | Responsibility |
|--------|---------------|
| `sseParser.ts` | Async generator parsing `ReadableStream<Uint8Array>` into typed `SSEEvent` objects. Handles chunk boundaries, UTF-8 multi-byte sequences, malformed JSON, `[DONE]` sentinel. |
| `events.ts` | SSE event type definitions (discriminated union). |

### Shared Types (`src/lib/shared/types.ts`)

`Settings`, `ConversationSummary`, `Message` — single source of truth across server/client boundary.

### Database Schema

Single migration (`migrations/001_initial.sql`):

- **conversations:** `id TEXT PK`, `title`, `created_at`, `updated_at` (epoch ms)
- **messages:** `id TEXT PK`, `conversation_id FK CASCADE`, `role CHECK(user|assistant)`, `content`, `thinking?`, `created_at`
- **settings:** `key TEXT PK`, `value` (key-value store; seeded with `name`, `personalizationPrompt`)

---

## 4. Client Architecture

### Hooks (`src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useStream` | Core streaming orchestrator. Fetches `/api/chat`, parses SSE via `sseParser`, accumulates tokens/thinking/TTFT/error state. Uses `startTransition` to deprioritize token renders below user interactions. Ref accumulators for synchronous reads despite deferred updates. |
| `useObservabilityEvents` | Composition wrapper bridging `useStream` lifecycle to `ObservabilityContext`. Drop-in replacement interface. Computes throughput, emits request metrics. |
| `useAutoScroll` | Auto-scrolls on new tokens; suspends when user scrolls >50px up. Uses `requestAnimationFrame` to coalesce multiple tokens into one scroll update per frame. |
| `useStallDetection` | Fires after 8s with no token during streaming. Prop-driven (observes `lastTokenAt`). Single `setTimeout` per token. |

### Components

**Chat (`src/components/chat/`):**

| Component | Purpose |
|-----------|---------|
| `ChatShell` | Main client orchestrator. Receives server-fetched data as props. Manages conversation state, URL history, retry flow. Composes all hooks. |
| `MessageItem` | Presentational message renderer. User bubbles vs. flat assistant layout. Copy button, TTFT badge, stall indicator. |
| `MessageList` | Scroll container with empty-state suggestion chips. |
| `StreamingMarkdown` | `react-markdown` + `remark-gfm`. Module-level stable references prevent re-reconciliation at 30-50 tokens/sec. |
| `ThinkingBlock` | Collapsible reasoning disclosure. "Thinking..." (pulsing) during stream, "Thought for Xs" after. |
| `InputArea` | Textarea with Enter-to-submit, Shift+Enter newline, Stop button during streaming. |
| `StallIndicator` | "Still working..." with Cancel option after 8s stall. |

**Layout (`src/components/layout/`):**

| Component | Purpose |
|-----------|---------|
| `HistoryPane` | Left sidebar. Conversations grouped by date. Collapsed = icon strip (56px), expanded = 280px. `useTransition` for async select/delete. Mobile overlay. |
| `ObservabilityPane` | Right sidebar debug pane. Three tabs: Metrics (request cards), Events (timestamped log), System Prompt. |

**Settings (`src/components/settings/`):**

| Component | Purpose |
|-----------|---------|
| `SettingsForm` | Client component receiving initial settings as props from server component parent. |

### Context (`src/context/`)

**`ObservabilityContext`** — In-memory event bus using `useReducer`. Three slices:
events (capped at 200), requests (capped at 10), systemPrompt. Pure reducer exported
for unit testing. No external state library needed.

---

## 5. Test Infrastructure

### Unit/Integration (Jest)

- **27 test files** across all layers (routes, libs, hooks, components, pages)
- **Custom Jest environment** (`jest-environment-with-fetch.js`): injects WinterCG globals (fetch, Response, ReadableStream, etc.) into jsdom for MSW 2.x compatibility
- **MSW server mode** for Node tests; module mocks for server-only imports
- **React Testing Library** with `renderHook()` for hooks, `render()` for components
- **Real SQLite** (`:memory:`) for db.test.ts; MSW for network-dependent tests

### E2E (Playwright)

- **8 test suites**: chat, streaming, history, settings, welcome, observability, layout, screenshots
- **MSW browser mode**: service worker activated per-test via `window.__msw.use(key)` string protocol
- **Real SQLite** for settings tests (server components bypass MSW); serial execution with DB reset
- **Fixtures** (`tests/e2e/fixtures.ts`): `useMSWHandler`, `resetMSWHandlers`, `sendChatMessage`

### MSW Handler Registry

12 handler scenarios: `normal`, `normal-alice`, `thinking`, `markdown`, `midstream-error`,
`midstream-error-partial`, `truncated`, `slow`, `stall`, `hold`, `conversations`, `settings`.
Most use `createSyncHandler()` factory for deterministic responses; timing-dependent ones
(`slow`, `stall`, `hold`) use manual `ReadableStream`.

### Quality Gates

Pre-commit hook runs sequentially: `type-check` → `lint` → `test` → `test:coverage`.
Claude Code hooks intercept commits and TASKS.md writes for additional validation.

---

## 6. Deviations from Original Spec

### Structural Additions (not in SPEC.md)

1. **`/chat/[id]` dynamic route** — SPEC.md defines only `/chat`. The build added a
   dynamic route for deep-linking to conversations with server-side pre-fetching of
   messages. This eliminates client-side fetch waterfalls when navigating to a specific
   conversation.

2. **`ChatShell` client component extraction** — SPEC.md shows `chat/page.tsx` as the
   main interactive component. The server component conversion (T34) split it into a
   server component shell (`page.tsx`) that pre-fetches data and a client component
   (`ChatShell.tsx`) that handles interactivity.

3. **`apiHelpers.ts` server module** — Not in original spec. Added to deduplicate
   validation and response construction across the four API routes.

4. **`handlerFactory.ts` MSW utility** — SPEC.md describes MSW handlers but not the
   factory pattern. Extracted (T29) to eliminate repeated encoder → events → stream →
   response boilerplate across 6+ handler files.

5. **React Compiler (`babel-plugin-react-compiler`)** — SPEC.md mentions
   `useMemo`/`useCallback` patterns. The build instead enabled React Compiler for
   automatic memoization, eliminating manual optimization calls.

### Behavioral Differences

6. **Thinking-tag parsing location** — SPEC.md section 7 describes parsing in the BFF
   route, which matches the build. However, the model adapter also handles
   `reasoning_content` / `reasoning` fields from Ollama's OpenAI-compatible format,
   wrapping them in `<think>` tags before they reach the BFF parser. This dual-layer
   approach was not specified.

7. **Settings E2E test strategy** — SPEC.md implies MSW for all tests. Settings E2E
   tests use real SQLite because the server component reads the database directly,
   bypassing the network layer that MSW intercepts. Tests run serially with DB reset.

8. **`useDeferredValue` not used** — SPEC.md section 6 specifies `useDeferredValue`
   for the message list. The build uses `startTransition` in `useStream` instead,
   achieving the same goal (deprioritizing token renders) at the state-update site
   rather than the consumption site.

### Scope Variations

9. **Phase 5 partial completion** — TASKS.md shows T32–T34 completed (shared types,
   settings server component, chat shell server component). SPEC.md's Phase 5 vision
   is fully realized for the implemented pages.

10. **No TransformStream pipelines** — Listed as "Future Considerations" in TASKS.md.
    The BFF writes SSE events imperatively rather than through composable stream
    pipelines.

11. **No Zod validation** — Also listed as future. API boundaries use manual validation
    via `ValidationError` class; downstream code trusts validated shapes.

---

## 7. Dependency Manifest

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| next | ^16.1.6 | Framework |
| react / react-dom | ^19.2.4 | UI library |
| better-sqlite3 | ^11.1.0 | SQLite driver (native, synchronous) |
| react-markdown | ^9.0.0 | Markdown rendering |
| remark-gfm | ^4.0.0 | GitHub Flavored Markdown |
| server-only | ^0.0.1 | Server boundary enforcement |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.5.0 | Type system |
| @biomejs/biome | ^1.9.0 | Lint + format (replaces ESLint + Prettier) |
| tailwindcss | ^3.4.0 | Utility CSS |
| jest | ^29.7.0 | Unit/integration tests |
| @playwright/test | ^1.48.0 | E2E tests |
| msw | ^2.4.0 | API mocking |
| @testing-library/react | ^16.0.0 | Component test utilities |
| babel-plugin-react-compiler | ^1.0.0 | Auto-memoization |

---

## 8. Configuration Summary

| Concern | Tool | Key Setting |
|---------|------|-------------|
| Type checking | `tsc --noEmit` | `strict: true`, no `any` |
| Linting/formatting | Biome | recommended rules, single quotes, 100-char lines |
| Package manager | pnpm 10.30.1 | Pinned in `packageManager` field |
| Container | Dev Containers | Node 22 Bookworm + SQLite3 + Playwright deps |
| Model access | Ollama | `host.docker.internal:11434`, configurable via env |
| Git enforcement | Pre-commit hook | type-check → lint → test → coverage |
| Claude Code | Hooks + Skills | PreToolUse (commit, TASKS.md), PostToolUse (refactoring) |
