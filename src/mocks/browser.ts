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

import type { RequestHandler } from 'msw';
import { setupWorker } from 'msw/browser';
import {
  conversationDeleteHandler,
  conversationMessagesHandler,
  conversationsListHandler,
} from './handlers/conversations';
import { holdHandler } from './handlers/hold';
import { markdownHandler } from './handlers/markdown';
import { midstreamErrorHandler } from './handlers/midstream-error';
import { midstreamErrorPartialHandler } from './handlers/midstream-error-partial';
import { normalHandler } from './handlers/normal';
import { normalAliceHandler } from './handlers/normal-alice';
import { settingsGetHandler, settingsPostHandler } from './handlers/settings';
import { slowHandler } from './handlers/slow';
import { stallHandler } from './handlers/stall';
import { thinkingHandler } from './handlers/thinking';

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

// Values may be a single handler or an array (e.g. the conversations key
// registers list + detail + delete routes together). `satisfies` preserves
// literal key types while enforcing value shape.
const HANDLERS = {
  normal: normalHandler,
  'normal-alice': normalAliceHandler,
  'midstream-error': midstreamErrorHandler,
  'midstream-error-partial': midstreamErrorPartialHandler,
  slow: slowHandler,
  stall: stallHandler,
  thinking: thinkingHandler,
  markdown: markdownHandler,
  hold: holdHandler,
  conversations: [conversationsListHandler, conversationMessagesHandler, conversationDeleteHandler],
  settings: [settingsGetHandler, settingsPostHandler],
} satisfies Record<string, RequestHandler | RequestHandler[]>;

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
    use: (key: HandlerKey) => {
      const h = HANDLERS[key];
      if (Array.isArray(h)) {
        w.use(...h);
      } else {
        w.use(h);
      }
    },
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
