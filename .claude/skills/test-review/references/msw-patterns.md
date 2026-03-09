# MSW v2 Patterns — Jest & Next.js Integration

## Setup architecture

### Centralized server with per-test overrides

The right pattern: define baseline handlers in a shared file, set up the server in a global setup file, and override per-test only when behavior needs to deviate.

```ts
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/user', () =>
    HttpResponse.json({ id: 1, name: 'Test User', role: 'admin' })
  ),
  http.get('/api/posts', () =>
    HttpResponse.json([{ id: 1, title: 'Hello World' }])
  ),
];
```

```ts
// src/mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

```ts
// jest.setup.ts
import { server } from './src/mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers()); // ← Reset to baseline after each test
afterAll(() => server.close());
```

**Why `onUnhandledRequest: 'error'`?** If a component fires a request you haven't mocked, you want the test to fail loudly — not silently pass while hitting a real server or returning undefined. This is the single most important MSW configuration decision.

### Per-test overrides

```ts
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

it('shows an error message when the user API fails', async () => {
  server.use(
    http.get('/api/user', () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }))
  );

  render(<UserProfile />);
  await screen.findByText('You must be logged in');
});
```

The override only lasts for this test. `resetHandlers()` in `afterEach` restores the baseline.

---

## Response fidelity

Mock responses must match the real API contract or your tests are lying to you. Use TypeScript types or Zod schemas to enforce this:

```ts
// types/api.ts
export type UserResponse = {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'viewer';
};
```

```ts
// mocks/handlers.ts
import type { UserResponse } from '@/types/api';

http.get('/api/user', (): Response => {
  const user: UserResponse = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    role: 'admin',
  };
  return HttpResponse.json(user);
}),
```

If the `UserResponse` type changes (e.g., `role` gets renamed), TypeScript will surface it in your handler — keeping mocks honest.

---

## Error and edge case coverage

Every endpoint mock should have at least three variants you can switch to in tests:

| Scenario | Pattern |
|---|---|
| Happy path | `HttpResponse.json(data)` |
| Not found | `HttpResponse.json({ message: 'Not found' }, { status: 404 })` |
| Server error | `HttpResponse.json({ message: 'Internal error' }, { status: 500 })` |
| Network failure | `HttpResponse.error()` |
| Empty list | `HttpResponse.json([])` |
| Slow response | `await delay(1000); return HttpResponse.json(data)` |

```ts
import { http, HttpResponse, delay } from 'msw';

// Network error (simulates offline, DNS failure, etc.)
http.get('/api/posts', () => HttpResponse.error()),

// Slow response (for testing loading states)
http.get('/api/posts', async () => {
  await delay(2000);
  return HttpResponse.json([]);
}),
```

---

## MSW with Next.js App Router

### Browser context (Playwright + MSW Service Worker)

For Playwright E2E tests that use MSW in the browser:

1. Register the service worker in your Next.js app conditionally:

```ts
// src/app/layout.tsx or a client component
if (process.env.NEXT_PUBLIC_API_MOCKING === 'enabled') {
  const { worker } = await import('@/mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

2. Set `NEXT_PUBLIC_API_MOCKING=enabled` in `.env.test`.

3. In Playwright, wait for the service worker to activate before running tests:

```ts
// playwright/fixtures.ts
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller !== null
  );
});
```

### Server-side requests (Route Handlers, Server Actions)

MSW does not intercept `fetch()` calls made on the Node.js server side (Route Handlers, Server Actions, `generateStaticParams`, etc.) in Next.js.

For these, use:
- **Jest**: mock the underlying data layer (db client, external SDK) directly — don't rely on MSW
- **Integration tests**: spin up a real local server (`next dev` or `next start`) and use MSW's Node handler to intercept outbound calls from the server

This is a common source of confusion: developers assume MSW will intercept everything and it doesn't intercept server-side `fetch` in Next.js by default.

---

## MSW v2 migration notes

MSW v2 changed the handler API. Flag these antipatterns if you see them:

| v1 (old) | v2 (correct) |
|---|---|
| `rest.get(url, (req, res, ctx) => res(ctx.json(data)))` | `http.get(url, () => HttpResponse.json(data))` |
| `res(ctx.status(404))` | `HttpResponse.json({}, { status: 404 })` |
| `res(ctx.networkError('message'))` | `HttpResponse.error()` |
| `res.once(...)` | `server.use(http.get(url, handler))` inside the test |

---

## Common pitfalls

| Pitfall | Fix |
|---|---|
| `resetHandlers()` missing from `afterEach` | Per-test overrides bleed into subsequent tests |
| `onUnhandledRequest` not set to `'error'` | Silent passthrough masks missing handlers |
| Mock response shape doesn't match real API | Type your handlers against API types |
| MSW not intercepting server-side fetch | Mock the data layer directly for server-side code |
| Service Worker not awaited in Playwright | Add `waitForFunction` checking `serviceWorker.controller` |
| Using v1 `rest.*` API after upgrading to v2 | Migrate to `http.*` + `HttpResponse` |
