# context

React context providers for cross-cutting state that multiple unrelated components need to access.

## Files

| File | Purpose |
|------|---------|
| `ObservabilityContext.tsx` | In-memory event bus for the debug pane. Stores events (flat log), per-request metrics, and the system prompt. Provides `addEvent`, `startRequest`, `updateRequest`, `setSystemPrompt`, and `clear` actions |

## Architecture decisions

- **`useReducer`, not `useState` or external store**: The observability state has three related slices (events, requests, systemPrompt) modified by five action types. A reducer makes state transitions explicit and testable as a pure function. An external store (e.g., Zustand with `useSyncExternalStore`) would introduce a pattern not used elsewhere in this codebase.
- **Reducer exported separately**: `observabilityReducer` is exported so it can be unit-tested as a pure function without rendering React components.
- **`ObservabilityEvent.type` is `string`, not a union**: The context is a generic event bus -- it stores any event type without enforcing vocabulary. The event names (`message_sent`, `stream_started`, etc.) are defined by the emitter (`useObservabilityEvents`), not the store.
- **Pre-formatted `payload` string**: Event payloads are formatted at emit time (e.g., `"42 chars"`, `"312ms TTFT"`) so the Events tab can display them directly without formatting logic at render time.
- **Capped collections**: Events are capped at 200, requests at 10, preventing unbounded memory growth during long sessions.

## Relationships

- **Depends on**: Nothing (leaf context provider)
- **Depended on by**: `src/hooks/useObservabilityEvents.ts` (emits events), `src/components/layout/ObservabilityPane.tsx` (reads state for display), `src/components/chat/ChatShell.tsx` (emits `response_copied`), `src/app/layout.tsx` (wraps the entire app in `ObservabilityProvider`)

## For new engineers

- **Modify first**: `ObservabilityContext.tsx` to add a new state slice or action type. Add the action to `ObservabilityAction`, handle it in `observabilityReducer`, and expose a new dispatch wrapper in the provider's `useMemo` block.
- **Gotchas**: The context value is memoized with `useMemo` keyed on `state`. `dispatch` is referentially stable (React guarantee), so the memo effectively re-computes only when state changes. Adding a non-dispatch dependency to the value object would require updating the `useMemo` dependency array.
