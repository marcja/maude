# Server Components Audit: Where to Draw the Server/Client Boundary in Maude

> **Date:** 2026-03-14
> **Verdict:** Selective server component adoption recommended — settings page and chat page shell.

## Context

Maude is entirely `'use client'` today. The Suspense audit (`docs/SUSPENSE_AUDIT.md`) established that this is correct for the streaming core, but raised the question: should *any* pages become server components? The answer is yes — two surgical conversions that eliminate client-side fetch waterfalls while keeping the streaming core correctly client-side.

Production AI assistants (ChatGPT, Claude.ai) use server components for their page shells — sidebar conversation lists, settings forms, layout chrome — while keeping the streaming chat client-side. Maude should mirror this pattern where it's pedagogically valuable.

---

## Analysis by candidate

### 1. Settings Page — CONVERT

**File:** `src/app/settings/page.tsx`

The settings page currently has a `'use client'` directive, fetches settings via `useEffect` on mount, and manages loading/error states for the initial load. This is the textbook case for server components: a page that reads from the database once and renders a form.

**What changes:**
- `settings/page.tsx` becomes a server component that calls `getSettings()` directly (server-side import, no API route needed for the read)
- A new `SettingsForm.tsx` client component receives initial settings as props
- The mount-time `useEffect` fetch, loading spinner, and load error state are eliminated (~25 lines removed)
- The `useActionState` save flow stays in the client child — form submission remains a client concern

**Why this is correct:**
- Settings is a SQLite read — sub-millisecond, no streaming, no reactivity needed
- Server components eliminate the render-then-fetch waterfall entirely: the page arrives with data already embedded
- Tests become simpler: pass props to `SettingsForm` instead of mocking `GET /api/settings`
- The architectural inconsistency (settings server-fetched, chat client-fetched) is actually *correct* — each page uses the right tool for its data access pattern

### 2. Chat Page Shell — CONVERT

**File:** `src/app/chat/page.tsx`

The chat page shell currently renders three columns client-side: HistoryPane (fetches conversations on mount), chat center, and ObservabilityPane. The shell itself doesn't need to be a client component — only its children do.

**What changes:**
- `chat/page.tsx` becomes a server component that calls `getConversations()` directly
- A new `ChatShell.tsx` client component receives `initialConversations` as a prop
- HistoryPane gains an `initialConversations` prop, using it for first render and falling back to client-side fetch for refreshes
- The page-level `'use client'` directive is removed

**Why this is correct:**
- The conversation list is a read-once-at-navigation concern — server components handle this perfectly
- HistoryPane still needs client-side re-fetching (after deletes, new conversations), so it remains a client component — but the *initial* load is server-side
- This mirrors the production sidebar pattern: server-rendered initial list, client-side updates
- Tests target `ChatShell` with prop-based initial data instead of mocking the conversations API endpoint

### 3. Streaming Core (useStream, hooks) — DO NOT CONVERT

**Files:** `src/hooks/useStream.ts`, `src/hooks/useStallDetection.ts`, `src/hooks/useAutoScroll.ts`

SSE streaming is inherently imperative and client-side. `useStream` manages an AbortController, parses an async iterable of SSE events, and calls `startTransition` on every token. None of this can run on the server. The Suspense audit already established this conclusively.

### 4. HistoryPane Component — DO NOT CONVERT

**File:** `src/components/layout/HistoryPane.tsx`

HistoryPane fetches conditionally (only when expanded), re-fetches on `refreshToken` changes, and handles click/delete events. These are all client concerns. The server component conversion in candidate #2 provides *initial* data, but the component itself stays client-side.

### 5. ObservabilityPane — DO NOT CONVERT

**File:** `src/components/layout/ObservabilityPane.tsx`

Pure client debug UI that reads from `ObservabilityContext`. No server data, no fetch — just context consumption and rendering. Must remain client-side.

### 6. Layout.tsx — ALREADY CORRECT

**File:** `src/app/layout.tsx`

Already a server component that renders client providers (`MSWProvider`, `ObservabilityProvider`). No changes needed — this is the correct pattern.

---

## Shared types extraction

Both conversions require types that currently live in server-only or component-local scopes:

| Type | Current location | Problem |
|------|-----------------|---------|
| `Settings` | `src/app/settings/page.tsx` (local interface) | Duplicated between server page and client form |
| `Conversation` | `src/components/layout/HistoryPane.tsx` (local interface) | Mirrors `ConversationRow` from `db.ts` but can't import it (server boundary) |

**Solution:** Create `src/lib/shared/types.ts` — a module importable by both server and client code. Extract `Settings` and the conversation summary shape here. Server code (`db.ts`) and client code (`SettingsForm`, `HistoryPane`) both import from this shared module.

This also eliminates the comment in HistoryPane about duplicating the server type: "Client-side types mirror the server's ConversationRow and MessageRow shapes. Cannot import from src/lib/server/db.ts (server-only boundary)."

---

## Testing impact

| Before | After |
|--------|-------|
| Settings tests mock `GET /api/settings` via MSW, then assert form renders | Settings tests render `<SettingsForm settings={...} />` with props — no fetch mock needed for initial load |
| Chat page tests mock `/api/conversations` for initial history load | Chat page tests render `<ChatShell initialConversations={[...]} />` — no mock needed for initial list |
| HistoryPane tests mock `/api/conversations` for all fetches | HistoryPane tests still mock for refresh/delete flows, but initial render uses props |

Tests become **simpler** because prop-based testing is more direct than fetch mocking. The MSW handlers for these endpoints remain for the API route unit tests and for Playwright E2E tests.

---

## Interview narrative

Key talking points this audit enables:

1. **Judgment, not dogma:** "I didn't make everything a server component because Next.js has them. I audited each component against its data access pattern. Settings reads once — server component. Streaming reads continuously — client component. The boundary follows the data, not the framework."

2. **The waterfall argument:** "The settings page had a render-then-fetch waterfall. The server component eliminates it entirely — the page arrives with data embedded. For a sub-millisecond SQLite read, the latency savings are negligible, but the architectural signal is correct."

3. **Production pattern recognition:** "Production assistants like Claude.ai use this exact split — server-rendered chrome (sidebar, settings) with a client-side streaming core. Maude mirrors that deliberately."

4. **Testing benefit:** "The conversion actually simplified tests. Instead of mocking `GET /api/settings`, I pass props directly to the form component. The test surface is smaller and more focused."

---

## What this intentionally does NOT do

- **No Server Actions for save.** The settings save stays as a `useActionState` form action hitting `POST /api/settings`. Server Actions would work but add a new pattern for no pedagogical gain — the existing form action is already React 19 idiomatic.
- **No artificial Suspense boundaries.** The server components fetch synchronously (SQLite is sub-millisecond). No `loading.tsx` files, no Suspense wrappers — because there's nothing to suspend on.
- **No streaming from server components.** The chat streaming pipeline stays entirely client-side. Server components provide *initial* data; the client handles everything after navigation.
- **No conversion of components that re-fetch.** HistoryPane and ObservabilityPane remain client components because they have ongoing data needs beyond initial load.
