/**
 * src/mocks/handlers/normal-alice.ts
 *
 * MSW handler identical to normalHandler but with a prompt_used value that
 * includes "Alice" — simulates the BFF having read name="Alice" from settings
 * and injected it via promptBuilder. Used by the M3 Playwright test to verify
 * the System Prompt tab displays the prompt_used value from the SSE stream.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { encodeEvent } from '../utils';

export const normalAliceHandler = http.post('/api/chat', () => {
  const encoder = new TextEncoder();

  const events: SSEEvent[] = [
    {
      type: 'message_start',
      message_id: 'alice-test-msg-id',
      prompt_used: "You are Maude, a helpful AI assistant.\n\nThe user's name is Alice.",
    },
    { type: 'content_block_start' },
    { type: 'content_block_delta', delta: { text: 'Hello' } },
    { type: 'content_block_delta', delta: { text: ' world' } },
    { type: 'content_block_stop' },
    { type: 'message_stop', usage: { input_tokens: 5, output_tokens: 2 } },
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
