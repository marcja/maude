/**
 * src/mocks/handlers/markdown.ts
 *
 * MSW handler that emits content containing a fenced code block.
 * Used by the M2 Playwright markdown test to verify that StreamingMarkdown
 * renders code fences correctly during and after streaming.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

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

export const markdownHandler = createSyncHandler(events);
