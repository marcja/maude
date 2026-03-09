/**
 * src/mocks/handlers/stall.ts
 *
 * MSW handler that simulates a token stream that stalls mid-response.
 * Emits 5 tokens at 100ms intervals, pauses for 10 seconds (exceeding the
 * 8s STALL_TIMEOUT_MS), then emits 5 more tokens before completing.
 *
 * Used by the M2 Playwright stall-detection test to verify:
 *   - "Still working…" indicator appears after 8s of silence
 *   - Cancel button aborts the stalled stream
 *   - Partial content is preserved after cancellation
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { delay, encodeEvent } from '../utils';

export const stallHandler = http.post('/api/chat', async ({ request }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SSEEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));

      emit({ type: 'message_start', message_id: 'stall-test' });
      emit({ type: 'content_block_start' });

      // Phase 1: 5 tokens at 100ms — arrive before the stall threshold.
      for (let i = 0; i < 5; i++) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        await delay(100, request.signal);
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        emit({ type: 'content_block_delta', delta: { text: `tok${i} ` } });
      }

      // Stall: 10s pause exceeds the 8s STALL_TIMEOUT_MS threshold.
      await delay(10_000, request.signal);
      if (request.signal.aborted) {
        controller.close();
        return;
      }

      // Phase 2: 5 more tokens after the stall resolves.
      for (let i = 5; i < 10; i++) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        await delay(100, request.signal);
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        emit({ type: 'content_block_delta', delta: { text: `tok${i} ` } });
      }

      emit({ type: 'content_block_stop' });
      emit({ type: 'message_stop', usage: { input_tokens: 1, output_tokens: 10 } });
      controller.close();
    },
  });

  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
});
