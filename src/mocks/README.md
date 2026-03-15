# mocks

MSW (Mock Service Worker) infrastructure for intercepting HTTP requests in both Jest unit tests and Playwright E2E tests. MSW intercepts at the network level (service worker in browser, Node.js interceptor in Jest), so application code uses real `fetch()` calls -- no mocking of the fetch API itself.

## Files

| File | Purpose |
|------|---------|
| `handlerFactory.ts` | Factory function `createSyncHandler()` that builds an MSW handler from an array of `SSEEvent` objects |
| `utils.ts` | `encodeEvent()` serializes an SSEEvent to the SSE wire format; `delay()` provides an abortable timer for timed handlers |
| `browser.ts` | Browser service worker setup for development and Playwright. Registers handlers in a string-keyed `HANDLERS` map and exposes `window.__msw` for Playwright coordination |
| `server.ts` | Node.js MSW server for Jest tests. Exports `setupMSWServer()` to register lifecycle hooks (beforeAll/afterEach/afterAll) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`handlers/`](handlers/README.md) | Pre-built request handlers for specific streaming scenarios (normal, error, thinking, stall, etc.) |

## Architecture decisions

- **MSW over mocking fetch**: MSW intercepts at the network level, so the entire fetch -> parse -> state pipeline runs in tests exactly as it does in production. Mocking `fetch` directly would skip the SSE parser and miss integration issues.
- **Separate `browser.ts` and `server.ts`**: Browser MSW uses a service worker (`setupWorker`); Node.js MSW uses request interception (`setupServer`). They share the same handler format but different transport mechanisms.
- **`handlerFactory.ts` separated from `utils.ts`**: The factory imports `http` and `HttpResponse` from MSW, which require Node internals unavailable in Jest's jsdom environment. `utils.ts` stays jsdom-safe (pure string/timer utilities) so it can be unit-tested directly.
- **String-keyed handler activation**: Playwright's `page.evaluate()` can only pass JSON-serializable values across the browser/test boundary. `browser.ts` maps string keys to handler references so tests call `window.__msw.use('normal')` instead of trying to serialize a function.
- **Opt-in server lifecycle**: Not all test files need MSW (e.g., `db.test.ts` runs in a Node environment with no network). `setupMSWServer()` is called explicitly in test files that need it, rather than auto-registering globally.

## Relationships

- **Depends on**: `src/lib/client/events.ts` (SSEEvent type for handler construction)
- **Depended on by**: All Jest test files that test network-dependent code, `src/app/MSWProvider.tsx` (imports `browser.ts`), `tests/e2e/fixtures.ts` (imports `HandlerKey` type)

## For new engineers

- **Modify first**: To add a new test scenario, create a handler file in `handlers/`, then register it in `browser.ts`'s `HANDLERS` map. For Jest-only scenarios, you can use `server.use()` directly without registering in `browser.ts`.
- **Gotchas**:
  - `onUnhandledRequest: 'error'` in `server.ts` means any unhandled fetch in a Jest test will throw. You must register a handler for every endpoint your test touches.
  - `onUnhandledRequest: 'bypass'` in `browser.ts` means unhandled requests pass through to real API routes in development. This is intentional -- MSW only intercepts when a test explicitly activates a handler.
  - The worker starts with no handlers by default. In development, all requests reach the real Next.js API routes unless a Playwright test has called `window.__msw.use()`.
