/**
 * src/mocks/handlers/zero-usage.ts
 *
 * MSW handler that emits content deltas but sends zero token counts in the
 * message_stop usage field — simulating a model backend that doesn't report
 * usage statistics. Used to test the client-side fallback in
 * useObservabilityEvents, which falls back to counting content_block_delta
 * events when the server returns zero output tokens.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

const events: SSEEvent[] = [
  { type: 'message_start', message_id: 'zero-usage-msg-id' },
  { type: 'content_block_start' },
  { type: 'content_block_delta', delta: { text: 'Hello' } },
  { type: 'content_block_delta', delta: { text: ' world' } },
  { type: 'content_block_delta', delta: { text: '!' } },
  { type: 'content_block_stop' },
  {
    type: 'message_stop',
    conversation_id: 'zero-usage.ts-conv',
    usage: { input_tokens: 0, output_tokens: 0 },
  },
];

export const zeroUsageHandler = createSyncHandler(events);
