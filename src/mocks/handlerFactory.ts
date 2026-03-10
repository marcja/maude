/**
 * src/mocks/handlerFactory.ts
 *
 * Factory for creating MSW handlers that synchronously stream a fixed SSE
 * event sequence. Extracted from the repeated boilerplate shared by normal,
 * normal-alice, thinking, markdown, midstream-error, and midstream-error-partial
 * handlers (T29 refactoring).
 *
 * Separated from utils.ts because `http` and `HttpResponse` from MSW require
 * Node internals that are unavailable in Jest's jsdom environment. Handler
 * files run only in the browser (via MSW service worker) or in Playwright,
 * so this import is safe here. utils.ts stays jsdom-testable.
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
