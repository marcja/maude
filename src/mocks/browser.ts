/**
 * src/mocks/browser.ts
 *
 * MSW browser service worker setup. Used in development and Playwright E2E
 * tests — never in production (MSWProvider guards on NODE_ENV).
 *
 * Design decisions:
 * - Worker starts with no handlers so normal development requests pass through
 *   to the real Next.js API routes without interception.
 * - Playwright tests activate specific handlers by string key via
 *   window.__msw.use(key). String keys (not function references) are required
 *   because Playwright's page.evaluate() only serialises JSON-compatible values
 *   across the browser/test boundary.
 * - All available handlers are pre-imported here so the key→handler lookup is
 *   synchronous and available the moment mountMSW() is called.
 */

import { setupWorker } from 'msw/browser';
import { midstreamErrorHandler } from './handlers/midstream-error';
import { normalHandler } from './handlers/normal';
import { slowHandler } from './handlers/slow';

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const HANDLERS = {
  normal: normalHandler,
  'midstream-error': midstreamErrorHandler,
  slow: slowHandler,
} as const;

export type HandlerKey = keyof typeof HANDLERS;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

// No default handlers — see module comment.
export const worker = setupWorker();

// ---------------------------------------------------------------------------
// Window bridge
// ---------------------------------------------------------------------------

/**
 * Mounts a serialisation-safe API on window so Playwright tests can activate
 * handlers by name without crossing the function-reference boundary.
 */
export function mountMSW(w: typeof worker): void {
  window.__msw = {
    use: (key: HandlerKey) => w.use(HANDLERS[key]),
    reset: () => w.resetHandlers(),
  };
}

// Type augmentation so TypeScript resolves window.__msw across the codebase.
declare global {
  interface Window {
    __msw?: {
      use: (key: HandlerKey) => void;
      reset: () => void;
    };
  }
}
