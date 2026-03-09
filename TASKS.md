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

- [x] T00 — Project skeleton, enforcement infrastructure, and dev container
      User value: development environment is fully operational; all quality
        gates are in place before any feature work begins
      Deliverable: `package.json` (pnpm + Biome + Jest + Playwright), `tsconfig.json`,
        `biome.json`, `CLAUDE.md`, `TASKS.md`, `.gitignore`, `.devcontainer/`,
        `docker-compose.yml`, `scripts/install-hooks.sh`, `scripts/pre-commit.sh`,
        `.claude/settings.json`, `.claude/hooks/` (all four files),
        `.claude/skills/` (three skills)
      Test: `pnpm install` succeeds; `pnpm type-check` and `pnpm lint` run cleanly
        on empty src; git pre-commit hook blocks a deliberately failing commit;
        `node .claude/hooks/validate_tasks.js TASKS.md` exits 0; container starts,
        port 3000 reachable, host.docker.internal resolves

---

## Phase 1 — Minimum Viable Chat
**Milestone M1:** The app runs. A user types a message and sees a streaming response.
Single-column layout; no history pane, no observability pane yet. This is the
end-to-end slice that proves the streaming pipeline works.

- [x] T01 — SQLite schema and migration runner
      User value: prerequisite for BFF to persist messages; also needed by T09
      Deliverable: `migrations/001_initial.sql`, `src/lib/server/db.ts`
      Test: migration runs cleanly; tables exist; default settings inserted

- [x] T02 — Model adapter (Ollama)
      User value: prerequisite for BFF to reach the model
      Deliverable: `src/lib/server/modelAdapter.ts`
      Test: unit test with mocked fetch; correct headers, `stream: true`,
        signal propagation, `model_unreachable` error on connection failure

- [x] T03 — SSE parser utility
      User value: prerequisite for client to consume the token stream
      Deliverable: `src/lib/client/sseParser.ts`
      Test: partial chunks, multi-event chunks, message_stop, error events

- [x] T04 — Prompt builder
      User value: prerequisite for BFF to construct system prompt from settings
      Deliverable: `src/lib/server/promptBuilder.ts`
      Test: base prompt assembled; name injection; personalization injection;
        empty settings produce clean base prompt

- [x] T05 — BFF route: happy path streaming
      User value: first end-to-end token flow from Ollama to HTTP response
      Deliverable: `src/app/api/chat/route.ts` (basic SSE emission, no abort yet)
      Depends: T01, T02, T04
      Test: MSW normal handler; event sequence (message_start → deltas →
        message_stop) reaches client; prompt_used field present in message_start

- [x] T06 — useStream hook (minimal)
      User value: React hook that drives the streaming UI; wires SSE to state
      Deliverable: `src/hooks/useStream.ts`
      Depends: T03
      Test: token accumulation; TTFT recorded; message_stop finalizes;
        error event sets error state; abort controller wired to Stop action

- [x] T07 — MessageItem component
      User value: renders a single chat message (user or assistant)
      Deliverable: `src/components/chat/MessageItem.tsx`
      Test: renders user message; renders assistant message with TTFT badge;
        copy button present; streaming state shows spinner

- [x] T08 — InputArea component
      User value: the input bar — submit, Stop button, keyboard shortcuts
      Deliverable: `src/components/chat/InputArea.tsx`
      Test: submit fires on Enter; Shift+Enter inserts newline; Stop button
        visible during streaming only; disabled when empty

- [x] T09 — BFF route: abort signal propagation + SQLite write
      User value: cancellation works end-to-end; completed messages are persisted
      Deliverable: updates to `src/app/api/chat/route.ts`
      Depends: T05, T01
      Test: abort mid-stream cancels Ollama fetch and writes no DB row;
        completed stream writes conversation + messages to DB with title

- [x] T10 — Minimal chat page (single-column)
      Note: split into two commits — T10A (MSW browser infrastructure) and T10B (chat page + E2E tests)
      User value: **M1 milestone** — app is runnable; type a message, see streaming
      Deliverable: `src/app/chat/page.tsx` (no history pane, no debug pane;
        MessageList + InputArea wired to useStream; minimal layout)
      Depends: T06, T07, T08
      Test (Playwright — M1 suite):
        - Happy path: message sent → tokens stream → message_stop → response shown
        - Cancellation: Stop clicked mid-stream → partial response shown
        - Auto-scroll: long response scrolls to bottom; manual scroll suspends;
          "↓ New content" button returns to bottom
        - Ollama unreachable: clear error message shown (not a generic 500)

---

## Phase 2 — Streaming Polish
**Milestone M2:** All production streaming behaviors work. Cancellation, stall
detection, thinking blocks, rich markdown rendering. The app handles failure modes
gracefully. No new layout — same single-column chat, but battle-hardened.

- [x] T11 — BFF route: thinking block detection
      User value: reasoning-trace models (DeepSeek-R1, QwQ) show their thinking
      Deliverable: state machine in `route.ts` for `<think>` tag parsing
      Depends: T05
      Test: unit test with token sequences that straddle tag boundaries;
        thinking_block_start / delta / stop events emitted correctly

- [x] T12 — ThinkingBlock component
      User value: collapsible "Thought for Xs" disclosure above response text
      Deliverable: `src/components/chat/ThinkingBlock.tsx`
      Test: collapsed by default; expands on click; "Thinking…" during stream;
        "Thought for Xs" on completion; never renders if no thinking events

- [x] T13 — StreamingMarkdown component
      User value: rich markdown rendering during and after streaming
      Deliverable: `src/components/chat/StreamingMarkdown.tsx`
      Depends: T06
      Test: partial markdown renders without throwing; code fence snaps to
        correct render on close; upgrade from plain text in MessageItem

- [x] T14 — useStallDetection hook
      User value: detects when the model stops producing tokens for 8 seconds
      Deliverable: `src/hooks/useStallDetection.ts`
      Test: timer fires after 8s with no token; resets on each token arrival;
        clears on stream end

- [ ] T15 — Stall indicator component
      User value: "Still working…" UI with Cancel option during stalls
      Deliverable: `src/components/chat/StallIndicator.tsx`
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
      Depends: T11, T12, T13, T14, T15, T16
      Test (Playwright — M2 suite):
        - Stall detection: 5 tokens → 8s pause → "Still working…" appears → Cancel
        - Mid-stream error: 10 tokens → error event → partial + "Retry?" shown
        - Thinking blocks: thinking handler → ThinkingBlock renders + collapses
        - Markdown: code block renders correctly during and after streaming

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
      Deliverable: `src/components/layout/ObservabilityPane.tsx`
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
        - Observability pane: two conversations → Metrics shows two cards;
          Events shows complete sequence; copy button → response_copied appears
        - System Prompt tab: name "Alice" set in settings → prompt shows it
        - Pane collapses and expands; center fills width when collapsed

---

## Phase 4 — Full App
**Milestone M4:** Complete application. Conversation history, settings, welcome
page, full three-column layout with history pane on the left.

- [ ] T22 — History pane component
      User value: browse and reload past conversations
      Deliverable: `src/components/layout/HistoryPane.tsx`
      Depends: T01
      Test: loads conversations from API; click restores all messages; delete
        with confirmation; new conversation starts fresh; pane collapses

- [ ] T23 — Full three-column layout
      User value: **M4 partial** — history + chat + observability all visible
      Deliverable: update `chat/page.tsx` to add left HistoryPane; all three
        columns present; each pane independently collapsible
      Depends: T21, T22
      Test (Playwright — M4 suite):
        - History loading: complete conversation → reload → prior messages shown;
          new message sent → request body contains prior messages as context
        - Both panes collapse/expand; center fills available width

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

- [x] T27 — refactor(T10B): deduplicate startTransition + extract className constants
      Scope: post-commit cleanup identified by analyze-refactoring after T10B
      Changes: (1) extract appendToken() helper in useStream.ts to eliminate two
        near-identical startTransition blocks; (2) lift user/assistant bubble class
        strings to named constants in MessageItem.tsx

- [x] T28 — refactor(route): extract chunk dispatcher from main token loop
      Scope: post-commit cleanup identified by analyze-refactoring after T11
      Changes: extract the chunk-to-SSE dispatch logic (lines 255-281 of route.ts)
        into a helper function that encapsulates block open/close state transitions,
        reducing cognitive load in the POST handler's main loop
      Depends: T11
