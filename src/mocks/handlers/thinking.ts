/**
 * src/mocks/handlers/thinking.ts
 *
 * MSW handler that simulates a model emitting a reasoning trace (thinking block)
 * before its visible response. Exercises the thinking_block_start → thinking_delta
 * → thinking_block_stop → content sequence that reasoning-trace models produce.
 *
 * All events emitted synchronously — no delays needed for unit tests.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { encodeEvent } from '../utils';

export const thinkingHandler = http.post('/api/chat', () => {
  const encoder = new TextEncoder();

  const events: SSEEvent[] = [
    { type: 'message_start', message_id: 'thinking-test' },
    { type: 'thinking_block_start' },
    { type: 'thinking_delta', delta: { text: 'Step 1: analyze.\n' } },
    { type: 'thinking_delta', delta: { text: 'Step 2: compute.\n' } },
    { type: 'thinking_block_stop' },
    { type: 'content_block_start' },
    { type: 'content_block_delta', delta: { text: 'The answer is 42.' } },
    { type: 'content_block_stop' },
    { type: 'message_stop', usage: { input_tokens: 5, output_tokens: 10 } },
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
