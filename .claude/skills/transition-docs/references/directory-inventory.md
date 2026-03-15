# Directory Inventory — Transition README Checklist

Each directory below needs a README.md. The "Must-Answer Questions" column
lists the specific "why" questions that README must address — generic
boilerplate is not acceptable.

## Processing order: leaves first, parents last

| # | Directory | Must-Answer Questions | Key Files | Related Directories |
|---|-----------|----------------------|-----------|-------------------|
| 1 | `src/lib/shared/` | Why do shared types exist separately from client and server types? What is the boundary rule? | `types.ts` | `src/lib/client/`, `src/lib/server/` |
| 2 | `src/lib/client/` | Why is the SSE parser an async generator and not a callback/event emitter? Why is the event schema defined here and not in shared? How does chunk boundary handling work? | `sseParser.ts`, `events.ts` | `src/lib/shared/`, `src/hooks/`, `src/mocks/` |
| 3 | `src/lib/server/migrations/` | Why SQLite? Why a single migration file? How are migrations applied? | `001_initial.sql` | `src/lib/server/db.ts` |
| 4 | `src/lib/server/` | Why does `server-only` matter? Why is modelAdapter the only file that reads env vars? What is the BFF's responsibility vs. the model adapter's? How does the thinking-tag parser work? | `modelAdapter.ts`, `db.ts`, `promptBuilder.ts`, `apiHelpers.ts` | `src/app/api/`, `src/lib/shared/` |
| 5 | `src/lib/` | Why the three-way split (client/server/shared)? What is the import rule? | (directory of subdirectories) | `src/hooks/`, `src/app/api/` |
| 6 | `src/mocks/handlers/` | Why so many handler files? What does each simulate? How do you add a new test scenario? | `normal.ts`, `thinking.ts`, `midstream-error.ts`, `stall.ts`, etc. | `src/mocks/handlerFactory.ts`, `src/mocks/utils.ts` |
| 7 | `src/mocks/` | Why MSW instead of mocking fetch directly? Why separate browser.ts and server.ts? Why is handlerFactory separate from utils? What is the jsdom limitation? | `handlerFactory.ts`, `utils.ts`, `browser.ts`, `server.ts` | `src/mocks/handlers/`, `tests/e2e/` |
| 8 | `src/hooks/` | How do the four hooks compose in ChatShell? Why refs instead of state for some values? Why startTransition for token updates? What is the onEvent callback pattern? | `useStream.ts`, `useAutoScroll.ts`, `useStallDetection.ts`, `useObservabilityEvents.ts` | `src/context/`, `src/components/chat/`, `src/lib/client/` |
| 9 | `src/context/` | Why useReducer instead of useState or an external store? Why is the reducer exported separately? Why is event payload pre-formatted? | `ObservabilityContext.tsx` | `src/hooks/useObservabilityEvents.ts`, `src/components/layout/ObservabilityPane.tsx` |
| 10 | `src/components/chat/` | Which component owns streaming state? How does token rendering flow from useStream to DOM? Why is StreamingMarkdown a separate component? What is the ThinkingBlock collapse pattern? | `ChatShell.tsx`, `MessageList.tsx`, `MessageItem.tsx`, `StreamingMarkdown.tsx`, `InputArea.tsx`, `ThinkingBlock.tsx`, `StallIndicator.tsx` | `src/hooks/`, `src/context/` |
| 11 | `src/components/layout/` | What is the HistoryPane's data source? How does ObservabilityPane consume the context? | `HistoryPane.tsx`, `ObservabilityPane.tsx` | `src/context/`, `src/app/api/conversations/` |
| 12 | `src/components/settings/` | What settings exist? How does the form submit? | `SettingsForm.tsx` | `src/app/api/settings/`, `src/app/settings/` |
| 13 | `src/components/` | What is the component hierarchy? Which are client components and why? | (directory of subdirectories) | `src/hooks/`, `src/context/`, `src/app/` |
| 14 | `src/app/api/chat/` | Why BFF pattern? Why HTTP 200 even on model errors? How does the thinking-tag state machine work? Why does the route build SSE manually instead of using a library? | `route.ts` | `src/lib/server/`, `src/lib/client/events.ts` |
| 15 | `src/app/api/conversations/` | What CRUD operations exist? Why dynamic route `[id]`? How is the conversation list used by HistoryPane? | `route.ts`, `[id]/route.ts` | `src/lib/server/db.ts`, `src/components/layout/HistoryPane.tsx` |
| 16 | `src/app/api/settings/` | What settings are persisted? Why an API route instead of server actions? | `route.ts` | `src/lib/server/db.ts`, `src/components/settings/SettingsForm.tsx` |
| 17 | `src/app/api/` | What is the API surface? How do the three route groups relate? | (directory of subdirectories) | `src/lib/server/`, `src/lib/client/events.ts` |
| 18 | `src/app/chat/` | Is this a server or client component? What does it pre-fetch? Why? | `page.tsx` | `src/components/chat/ChatShell.tsx`, `src/lib/server/db.ts` |
| 19 | `src/app/settings/` | Is this a server or client component? What does it pre-fetch? | `page.tsx` | `src/components/settings/SettingsForm.tsx`, `src/lib/server/db.ts` |
| 20 | `src/app/` | What is the routing structure? What does the root layout provide? What is MSWProvider and when does it activate? | `layout.tsx`, `page.tsx`, `MSWProvider.tsx`, `globals.css` | `src/components/`, `src/mocks/` |
| 21 | `src/` | What is the top-level organization principle? What are the import rules across directories? | (all subdirectories) | Project root |
| 22 | `tests/e2e/` | What do E2E tests cover? How does MSW work at the Playwright level? What fixtures/setup are needed? | All `*.spec.ts` files | `src/mocks/`, `playwright.config.ts` |

## Completion tracking

Mark each directory done as its README is written:

- [x] 1. `src/lib/shared/`
- [x] 2. `src/lib/client/`
- [x] 3. `src/lib/server/migrations/`
- [x] 4. `src/lib/server/`
- [x] 5. `src/lib/`
- [x] 6. `src/mocks/handlers/`
- [x] 7. `src/mocks/`
- [x] 8. `src/hooks/`
- [x] 9. `src/context/`
- [x] 10. `src/components/chat/`
- [x] 11. `src/components/layout/`
- [x] 12. `src/components/settings/`
- [x] 13. `src/components/`
- [x] 14. `src/app/api/chat/`
- [x] 15. `src/app/api/conversations/`
- [x] 16. `src/app/api/settings/`
- [x] 17. `src/app/api/`
- [x] 18. `src/app/chat/`
- [x] 19. `src/app/settings/`
- [x] 20. `src/app/`
- [x] 21. `src/`
- [x] 22. `tests/e2e/`
