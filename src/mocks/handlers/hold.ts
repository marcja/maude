/**
 * src/mocks/handlers/hold.ts
 *
 * MSW handler for a /api/chat request that stalls indefinitely — it opens an
 * SSE response but never emits any events. The stream terminates only when the
 * request's AbortSignal fires (e.g. the client calls stop()).
 *
 * Used by tests that need to verify abort/cancellation behaviour: the stream
 * is open long enough for assertions about isStreaming state, then aborted.
 */

import { http, HttpResponse } from 'msw';

export const holdHandler = http.post('/api/chat', ({ request }) => {
  const stream = new ReadableStream({
    start(controller) {
      // When the caller aborts, propagate as an error so parseSSEStream's
      // reader.read() rejects with an AbortError rather than blocking forever.
      request.signal.addEventListener(
        'abort',
        () => controller.error(new DOMException('The operation was aborted.', 'AbortError')),
        { once: true }
      );
    },
  });

  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});
