/**
 * src/mocks/handlers/thinking.ts
 *
 * MSW handler that simulates a model emitting a reasoning trace (thinking block)
 * before its visible response. Exercises the thinking_block_start → thinking_delta
 * → thinking_block_stop → content sequence that reasoning-trace models produce.
 *
 * All events emitted synchronously — no delays needed for unit tests.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

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

export const thinkingHandler = createSyncHandler(events);
