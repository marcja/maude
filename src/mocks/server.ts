/**
 * src/mocks/server.ts
 *
 * Shared MSW server for Jest tests. Centralises lifecycle management so every
 * test file gets the same safety guarantees — in particular
 * `onUnhandledRequest: 'error'`, which prevents silent network passthrough.
 *
 * Usage in a test file:
 *   import { server } from '../../mocks/server';
 *   setupMSWServer();           // registers beforeAll/afterEach/afterAll
 *   server.use(someHandler);    // per-test overrides as usual
 *
 * Why a function instead of auto-registering in jest.setup.ts: not all test
 * files use MSW (e.g. db.test.ts runs in @jest-environment node with no
 * network layer). Opt-in keeps the server scoped to tests that need it.
 */

import { setupServer } from 'msw/node';

export const server = setupServer();

/**
 * Register MSW lifecycle hooks for the current test file.
 * Call at the module top-level (outside any describe block) so the hooks
 * are scoped to the file's entire suite.
 */
export function setupMSWServer() {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
