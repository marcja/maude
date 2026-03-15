# components

React components organized by feature area. All components in this directory (and subdirectories) are client components (`'use client'` directive) because they use hooks, event handlers, or browser APIs.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`chat/`](chat/README.md) | Chat UI: orchestrator (`ChatShell`), message rendering, input, thinking blocks, Markdown |
| [`layout/`](layout/README.md) | Side panels: conversation history (left) and observability/debug (right) |
| [`settings/`](settings/README.md) | Settings form with name and personalization prompt |

## Component hierarchy

```
RootLayout (server)
  ObservabilityProvider
    MSWProvider
      ChatPage (server) or SettingsPage (server)
        ChatShell (client) ─── or ─── SettingsForm (client)
          HistoryPane
          MessageList
            MessageItem
              StreamingMarkdown
            ThinkingBlock
          InputArea
          ObservabilityPane
```

## Architecture decisions

- **All client components**: Every component in this tree uses hooks or event handlers, requiring the `'use client'` directive. Server components exist only at the page level (`src/app/chat/page.tsx`, `src/app/settings/page.tsx`), where they pre-fetch data from SQLite and pass it as props.
- **Presentational children, stateful orchestrator**: `ChatShell` owns all interactive state and hook composition. Child components (`MessageItem`, `MessageList`, `InputArea`, `ThinkingBlock`) are purely presentational -- they receive data and callbacks as props, making them independently testable.
- **No shared component library**: Components are organized by feature, not by abstraction level. There is no `components/ui/Button.tsx` pattern -- Tailwind utility classes are applied directly.

## Relationships

- **Depends on**: `src/hooks/`, `src/context/`, `src/lib/shared/types.ts`, `src/lib/client/events.ts`
- **Depended on by**: `src/app/` page components

## For new engineers

- **Modify first**: Depends on the feature. Chat behavior changes start in `chat/ChatShell.tsx`. Visual changes to messages go in `chat/MessageItem.tsx` or `chat/StreamingMarkdown.tsx`. New side panel features go in `layout/`.
- **Gotchas**: No component in this directory may import from `src/lib/server/`. The `server-only` build guard will fail the build if this boundary is violated.
