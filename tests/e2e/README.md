# e2e

Playwright end-to-end tests that exercise the full application through a real browser. MSW service worker intercepts API requests at the network level, so tests control the streaming response without needing Ollama running.

## Files

| File | Purpose |
|------|---------|
| `fixtures.ts` | Shared utilities: `useMSWHandler()` activates a named MSW handler, `resetMSWHandlers()` cleans up after tests, `sendChatMessage()` consolidates the navigate-activate-type-submit pattern |
| `chat.spec.ts` | Chat core tests: happy-path message flow, cancellation with partial content, auto-scroll behavior, error display |
| `streaming.spec.ts` | Streaming UX tests: stall detection ("Still working..." after 8s), mid-stream error with Retry, thinking block render/collapse/expand, Markdown code block rendering |
| `history.spec.ts` | History pane: load conversations, select one, verify messages appear, send follow-up with prior context in request body |
| `settings.spec.ts` | Settings page: load/edit/save with success feedback, persistence on reload, "Back to chat" navigation. Uses real SQLite (no MSW for settings page server component) |
| `welcome.spec.ts` | Welcome page: "Start chatting" navigation, Settings navigation, end-to-end settings injection (set name -> chat -> System Prompt tab shows name) |
| `observability.spec.ts` | Debug pane: metrics cards across multiple conversations, event timeline, copy event emission, System Prompt tab display |
| `layout.spec.ts` | Three-column layout: debug pane collapse/expand, both panes collapse/expand, center column width adjustment |
| `screenshots.spec.ts` | Visual QA: captures screenshots of all UI states for manual review (not a permanent test) |

## Architecture decisions

- **MSW at the browser level**: Tests use the MSW service worker (initialized by `MSWProvider`) rather than Playwright's `page.route()`. This means the full client-side code path (fetch -> SSE parse -> React state -> DOM) runs exactly as in production.
- **String-keyed handler activation**: Playwright's `page.evaluate()` can only serialize JSON values. Tests call `window.__msw.use('normal')` with a string key that maps to a pre-imported handler in `browser.ts`. See `fixtures.ts` for the helper.
- **Real SQLite for settings tests**: The settings page is a server component that reads directly from SQLite on the server side. MSW cannot intercept server-component data fetching, so settings tests use the real database and reset state via `POST /api/settings` in `beforeEach`.
- **`sendChatMessage()` helper**: Most chat tests share the same 4-step setup: navigate to `/chat`, activate an MSW handler, fill the input, press Enter. The helper consolidates this pattern.
- **Serial mode for settings**: Settings tests run serially (`test.describe.configure({ mode: 'serial' })`) because they share a real SQLite database and would pollute each other's state if run in parallel.

## Relationships

- **Depends on**: `src/mocks/browser.ts` (HandlerKey type), all MSW handlers in `src/mocks/handlers/`
- **Depended on by**: Nothing (test-only code)

## For new engineers

- **Modify first**: `fixtures.ts` to add a new shared test utility. Add new spec files for new feature areas. Copy the pattern from `chat.spec.ts` for new chat-related tests.
- **Gotchas**:
  - Tests must call `await useMSWHandler(page, key)` AFTER `page.goto()` -- the MSW worker mounts asynchronously on first navigation.
  - Always call `resetMSWHandlers(page)` in `afterEach` to prevent handler leaks between tests.
  - The stall detection test uses `test.slow()` because it waits 8+ seconds for the stall threshold.
  - Next.js injects a route-announcer element with `role="alert"`. Error assertions should use specific selectors (e.g., `.chat__error`) to avoid matching the route announcer.
