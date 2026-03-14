# Suspense Audit: Where (and Where Not) to Use `<Suspense>` in Maude

> **Date:** 2026-03-14
> **Verdict:** Suspense is not recommended for this codebase. The absence is the correct architectural choice.

## Context

Maude is a fully `'use client'` Next.js App Router chat app with a three-column layout (HistoryPane | Chat | ObservabilityPane). It uses `useEffect`-based fetching, SSE streaming via `useStream` + `startTransition`, and `useActionState` for forms. No `<Suspense>`, `React.lazy()`, or `use()` hook exists anywhere today.

---

## Analysis by candidate

### 1. SSE Streaming (Chat) — DO NOT USE SUSPENSE

Suspense is binary (suspended vs. resolved). Streaming is incremental — tokens arrive one-at-a-time and must render progressively. There is no promise to suspend on; the SSE stream is an async iterable yielding hundreds of events over seconds. `useStream` already uses `startTransition` (the correct React 19 primitive for deprioritizing rapid incremental updates). AbortController lifecycle, stall detection, and thinking block state machines are all imperative — Suspense cannot express them.

**File:** `src/hooks/useStream.ts` — `startTransition` at lines ~238, ~258

### 2. Independent Pane Loading — DO NOT USE SUSPENSE

Suspense boundaries only activate when a child *suspends* (throws a promise). None of these panes suspend — they use `useEffect` + `useState`, which does not trigger Suspense. To make them suspend, you'd need a Suspense-compatible data library (React Query `useSuspenseQuery`, SWR `suspense: true`), which would be a major architectural change for a pedagogical app that intentionally demonstrates low-level patterns.

The panes already load independently today: HistoryPane shows "Loading…" text, ObservabilityPane reads from synchronous context, and the chat area is interactive immediately. Suspense boundaries would change nothing visible.

### 3. `React.lazy()` for StreamingMarkdown — POSSIBLE, LOW PRIORITY

`react-markdown` + `remark-gfm` are the heaviest client dependencies. Lazy-loading `StreamingMarkdown` would defer them until the first assistant message renders.

**Why it's low priority:**
- The chat page is the app's primary page — users navigate there immediately, so the bundle loads on first navigation regardless
- The lazy fallback would show raw text briefly, which is fine but rarely noticeable
- The component is always needed within seconds of page load (first assistant response)
- Migration is trivial (one `React.lazy` + one `<Suspense>` wrapper in MessageItem) but adds a new pattern for minimal gain

**If implemented:**
- `src/components/chat/MessageItem.tsx`: Replace static import with `React.lazy(() => import('./StreamingMarkdown'))`, wrap in `<Suspense fallback={<span>{content}</span>}>`
- No other files change

### 4. Settings Page Server Component — POSSIBLE, LOW PRIORITY

Convert `src/app/settings/page.tsx` to a server component that calls `getSettings()` directly (bypassing the API route), passing data as props to a `SettingsForm` client child. Eliminates the mount-time `useEffect` fetch, the loading spinner, and ~25 lines of load/error state.

**Why it's low priority:**
- Settings is a local SQLite read — sub-millisecond. The "Loading settings…" flash is nearly imperceptible
- Would require splitting one file into two (server page + client form)
- Would require updating MSW-based tests (GET `/api/settings` mock would no longer exercise the page)
- Creates architectural inconsistency: settings uses server-component fetching while chat uses client-side fetching (though this is actually correct — each page uses the right tool)
- The settings page already explains in its docstring *why* it can't use `use()` — this is pedagogically valuable as-is

### 5. History Pane — DO NOT USE SUSPENSE

HistoryPane fetches conditionally (only when expanded) and re-fetches on `refreshToken` changes. This is inherently a client-side concern — server components can't model conditional/re-fetchable data. The pane is always mounted (collapsed state preserved), so lazy-loading would delay the collapsed strip render.

---

## Why the current patterns are adequate

| Pattern | React 19 primitive used | Status |
|---------|------------------------|--------|
| Streaming tokens | `startTransition` | Correct — deprioritizes rapid updates |
| Form save | `useActionState` | Correct — React 19 idiomatic |
| Mount-time fetch | `useEffect` + `useState` | Correct for client components with no server parent |
| Conditional fetch | `useEffect` + AbortController | Correct — Suspense can't model conditional re-fetch |

The app is `'use client'` throughout by design — it's a pedagogical tool for learning imperative streaming patterns. Suspense's primary value proposition (server-driven async data fetching) doesn't apply. The React 19 features that *do* matter here (`startTransition`, `useActionState`) are already in use.

---

## Recommendation

**No changes needed.** The absence of `<Suspense>` is not a gap — it's the correct choice for an app where all data fetching is client-initiated, imperative, and often incremental (SSE).
