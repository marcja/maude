/**
 * src/mocks/handlers/slow.ts
 *
 * MSW handler for streaming scenarios that need real inter-token delays.
 * Used by Playwright tests for:
 *   - Cancellation: click Stop after partial tokens arrive
 *   - Auto-scroll: scroll up while tokens are still streaming
 *
 * Sends 100 tokens at 100ms intervals so tests have a ~10s window to
 * interact mid-stream. The abort signal is checked between tokens so
 * clicking Stop cleanly terminates the stream without further enqueuing.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { delay, encodeEvent } from '../utils';

export const slowHandler = http.post('/api/chat', ({ request }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const bookend = (event: SSEEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));

      bookend({ type: 'message_start', message_id: 'slow-test' });
      bookend({ type: 'content_block_start' });

      for (let i = 0; i < 100; i++) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }

        await delay(100, request.signal);

        if (request.signal.aborted) {
          controller.close();
          return;
        }

        controller.enqueue(
          encoder.encode(encodeEvent({ type: 'content_block_delta', delta: { text: `word${i} ` } }))
        );
      }

      bookend({ type: 'content_block_stop' });
      bookend({ type: 'message_stop', usage: { input_tokens: 1, output_tokens: 100 } });
      controller.close();
    },
  });

  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});
