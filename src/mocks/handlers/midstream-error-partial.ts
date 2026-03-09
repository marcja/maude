/**
 * src/mocks/handlers/midstream-error-partial.ts
 *
 * MSW handler that emits 10 content tokens then an error event.
 * Unlike midstream-error.ts (1 token), this handler provides enough partial
 * content for Playwright to verify both the error display and token retention.
 *
 * Used by the M2 mid-stream error test.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { encodeEvent } from '../utils';

export const midstreamErrorPartialHandler = http.post('/api/chat', () => {
  const encoder = new TextEncoder();

  const events: SSEEvent[] = [
    { type: 'message_start', message_id: 'error-partial-test' },
    { type: 'content_block_start' },
    ...Array.from({ length: 10 }, (_, i) => ({
      type: 'content_block_delta' as const,
      delta: { text: `word${i} ` },
    })),
    { type: 'error', error: { message: 'Stream failed', code: 'stream_error' } },
  ];

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
