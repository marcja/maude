/**
 * src/mocks/handlers/markdown.ts
 *
 * MSW handler that emits content containing a fenced code block.
 * Used by the M2 Playwright markdown test to verify that StreamingMarkdown
 * renders code fences correctly during and after streaming.
 */

import { http, HttpResponse } from 'msw';
import type { SSEEvent } from '../../lib/client/events';
import { encodeEvent } from '../utils';

export const markdownHandler = http.post('/api/chat', () => {
  const encoder = new TextEncoder();

  const events: SSEEvent[] = [
    { type: 'message_start', message_id: 'markdown-test' },
    { type: 'content_block_start' },
    { type: 'content_block_delta', delta: { text: 'Here is code:\n\n' } },
    { type: 'content_block_delta', delta: { text: '```js\n' } },
    { type: 'content_block_delta', delta: { text: 'const x = 42;\n' } },
    { type: 'content_block_delta', delta: { text: '```\n\n' } },
    { type: 'content_block_delta', delta: { text: 'Done.' } },
    { type: 'content_block_stop' },
    { type: 'message_stop', usage: { input_tokens: 1, output_tokens: 6 } },
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
