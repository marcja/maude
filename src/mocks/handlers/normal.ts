/**
 * src/mocks/handlers/normal.ts
 *
 * MSW handler for the happy-path /api/chat scenario.
 * Emits a complete, well-formed SSE sequence:
 *   message_start → content_block_start → deltas → content_block_stop → message_stop
 *
 * Tokens: "Hello" + " world" — predictable strings tests can assert against.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

const events: SSEEvent[] = [
  {
    type: 'message_start',
    message_id: 'test-msg-id',
    prompt_used: 'You are a helpful assistant.',
  },
  { type: 'content_block_start' },
  { type: 'content_block_delta', delta: { text: 'Hello' } },
  { type: 'content_block_delta', delta: { text: ' world' } },
  { type: 'content_block_stop' },
  { type: 'message_stop', usage: { input_tokens: 3, output_tokens: 2 } },
];

export const normalHandler = createSyncHandler(events);
