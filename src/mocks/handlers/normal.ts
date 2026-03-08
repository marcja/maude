/**
 * src/mocks/handlers/normal.ts
 *
 * MSW handler for the happy-path /api/chat scenario.
 * Emits a complete, well-formed SSE sequence:
 *   message_start → content_block_start → deltas → content_block_stop → message_stop
 *
 * Tokens: "Hello" + " world" — predictable strings tests can assert against.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { encodeEvent } from '../utils';

export const normalHandler = http.post('/api/chat', () => {
  const encoder = new TextEncoder();

  const events: SSEEvent[] = [
    { type: 'message_start', message_id: 'test-msg-id' },
    { type: 'content_block_start' },
    { type: 'content_block_delta', delta: { text: 'Hello' } },
    { type: 'content_block_delta', delta: { text: ' world' } },
    { type: 'content_block_stop' },
    { type: 'message_stop', usage: { input_tokens: 3, output_tokens: 2 } },
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
