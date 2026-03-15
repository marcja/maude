# layout

Side-panel components that flank the chat center column. Both follow the same collapse/expand pattern: a narrow icon strip when collapsed, a fixed-width panel when expanded.

## Files

| File | Purpose |
|------|---------|
| `HistoryPane.tsx` | Left sidebar: conversation list fetched from `/api/conversations`, grouped by date (Today/Yesterday/Last week/Older). Supports selection (loads messages), deletion (with `window.confirm`), and "New chat" |
| `ObservabilityPane.tsx` | Right sidebar: debug pane with three tabs (Metrics, Events, Prompt). Reads entirely from `ObservabilityContext` -- no props needed for data |

## Architecture decisions

- **HistoryPane data strategy**: The server component parent passes `initialConversations` so the pane renders without a loading flash. A `useEffect` re-fetches on expand and when `refreshToken` changes (after each completed stream). This hybrid approach gives instant first render plus fresh data after mutations.
- **ObservabilityPane reads from context only**: All observability data flows through `ObservabilityContext`. The pane has no fetch logic -- it purely renders the context's state slices across three tabs.
- **`useTransition` for async actions in HistoryPane**: Conversation selection and deletion are wrapped in `useTransition` (React 19 async transitions) so the pane stays interactive during fetch operations. The `window.confirm()` for deletion runs synchronously before the transition starts.
- **Date grouping is presentational**: `groupByDate()` in HistoryPane assigns conversations to buckets (Today, Yesterday, Last week, Older) purely for display. The API returns conversations sorted by `updated_at DESC`; grouping happens client-side.

## Relationships

- **Depends on**: `src/context/ObservabilityContext.tsx` (ObservabilityPane), `src/lib/shared/types.ts` (ConversationSummary, Message), Next.js `Link` component
- **Depended on by**: `src/components/chat/ChatShell.tsx` (renders both panes in the three-column layout)

## For new engineers

- **Modify first**: `HistoryPane.tsx` to change the conversation list display or add features (search, rename). `ObservabilityPane.tsx` to add a new debug tab or change metric formatting.
- **Gotchas**:
  - HistoryPane's `prevInitial` pattern synchronizes state when the server component re-renders with different props (e.g., browser back/forward). `useState` only reads the initial value on first mount, so subsequent prop changes need explicit synchronization.
  - ObservabilityPane uses internal sub-components (`MetricsCard`, `EventRow`) that are not exported -- they are layout-specific and not intended for reuse.
  - Both panes use mobile overlay patterns: a fixed backdrop on small screens, inline side-by-side layout on `sm:` and above.
