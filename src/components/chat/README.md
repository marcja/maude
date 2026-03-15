# chat

Client components that compose the chat UI. `ChatShell` is the orchestrator -- it owns all interactive state, composes the four hooks, and renders the other components as presentational children.

## Files

| File | Purpose |
|------|---------|
| `ChatShell.tsx` | Orchestrator: owns message history, conversation state, hook composition (useObservabilityEvents, useAutoScroll, useStallDetection), and all event handlers. Renders the three-column layout with HistoryPane and ObservabilityPane |
| `MessageList.tsx` | Scroll container for messages. Intentionally thin -- displays an empty state with suggestion chips, or renders its children. Scroll logic lives in the parent via `useAutoScroll` |
| `MessageItem.tsx` | Renders a single message. User messages are plain text bubbles; assistant messages use StreamingMarkdown. Shows TTFT badge, copy button, streaming indicator, and stall state |
| `StreamingMarkdown.tsx` | Renders assistant content as Markdown using `react-markdown` + `remark-gfm`. Handles partial/incomplete Markdown gracefully during streaming |
| `InputArea.tsx` | Textarea with auto-resize, Enter-to-submit, and Send/Stop button toggle. Controlled input cleared after submit |
| `ThinkingBlock.tsx` | Collapsible disclosure for model reasoning traces. Visible during streaming, auto-collapses after completion, expandable by click |

## Architecture decisions

- **ChatShell owns streaming state**: Hooks (`useStream` via `useObservabilityEvents`) live in ChatShell, not in child components. Children are purely presentational and receive all data as props, making them independently testable without mocking hooks.
- **Token flow: hook -> state -> props -> DOM**: `useStream` accumulates tokens in state. ChatShell passes `tokens` to `MessageItem`, which passes `content` to `StreamingMarkdown`, which re-renders on each token. `startTransition` in `useStream` ensures these renders don't block user interactions.
- **StreamingMarkdown as a separate component**: Extracted from MessageItem because Markdown rendering (react-markdown + remark-gfm) has different performance characteristics than message layout. The `REMARK_PLUGINS` and `COMPONENTS` arrays are hoisted to module scope to avoid re-creating them on every render (30-50 tokens/sec).
- **ThinkingBlock's three display states**: `isThinking=true` (streaming, content visible), `isThinking=false + text` (completed, collapsed by default), `isThinking=false + no text` (renders nothing). This avoids a separate "has thinking" prop.
- **popstate handler for browser navigation**: ChatShell listens for `popstate` events to sync client state when the user navigates with back/forward, re-fetching conversation data from the API.

## Relationships

- **Depends on**: `src/hooks/` (useObservabilityEvents, useAutoScroll, useStallDetection), `src/context/ObservabilityContext.tsx`, `src/lib/shared/types.ts`, `src/components/layout/` (HistoryPane, ObservabilityPane)
- **Depended on by**: `src/app/chat/page.tsx` and `src/app/chat/[id]/page.tsx` (server component parents that pass initial data as props)

## For new engineers

- **Modify first**: `ChatShell.tsx` for new interactive behavior (e.g., retry logic, conversation branching). `MessageItem.tsx` for visual changes to individual messages. `StreamingMarkdown.tsx` for Markdown rendering adjustments.
- **Gotchas**:
  - `ChatShell` uses `window.history.pushState`/`replaceState` for URL updates instead of Next.js router, because the chat is a single client component managing its own navigation state.
  - `MessageItem` uses `sender` (not `role`) as the prop name to avoid colliding with the HTML ARIA `role` attribute, which Biome's linter checks.
  - `StreamingMarkdown` does not need try/catch for partial Markdown -- `react-markdown` gracefully handles unclosed fences and incomplete markup by treating them as plain text.
