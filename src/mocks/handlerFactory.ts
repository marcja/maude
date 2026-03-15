/**
 * src/mocks/handlerFactory.ts
 *
 * Factory for creating MSW handlers that synchronously stream a fixed SSE
 * event sequence. Each handler file (normal.ts, thinking.ts, etc.) reduces to
 * its event array plus a one-liner factory call — the factory eliminates the
 * repeated boilerplate of intercepting POST /api/chat, encoding events to SSE
 * format, and closing the stream.
 *
 * Why synchronous handlers: unit tests need deterministic, instant responses
 * (all events written in one pass). Async handlers with delays exist only for
 * stall/slow scenarios in Playwright tests.
 *
 * Why this file is separate from utils.ts: `http` and `HttpResponse` from MSW
 * import Node/browser internals that crash in Jest's jsdom environment. Since
 * test files import utils.ts (for encodeEvent, buildSSEEvent, etc.), utils.ts
 * must stay jsdom-safe. Handler files run only in the browser (MSW service
 * worker) or in Playwright's Node context, so this MSW import is safe here.
 * Merging this into utils.ts would break all Jest tests that import utils.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../lib/client/events';
import { encodeEvent } from './utils';

/**
 * Creates an MSW handler that synchronously streams all events as SSE.
 * Each handler file reduces to its event array + a one-liner factory call.
 */
export function createSyncHandler(events: SSEEvent[]) {
  return http.post('/api/chat', () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}
