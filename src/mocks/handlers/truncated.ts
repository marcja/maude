/**
 * src/mocks/handlers/truncated.ts
 *
 * MSW handler that simulates a connection drop mid-stream.
 * Emits 8 tokens then closes the stream without message_stop —
 * the kind of silent failure caused by a proxy timeout, network reset,
 * or server crash after the HTTP 200 has already been committed.
 *
 * Used by useStream tests to verify truncation detection:
 * the hook must set error, clear isStreaming, and preserve partial tokens.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

const events: SSEEvent[] = [
  { type: 'message_start', message_id: 'truncated-test' },
  { type: 'content_block_start' },
  { type: 'content_block_delta', delta: { text: 'one' } },
  { type: 'content_block_delta', delta: { text: ' two' } },
  { type: 'content_block_delta', delta: { text: ' three' } },
  { type: 'content_block_delta', delta: { text: ' four' } },
  { type: 'content_block_delta', delta: { text: ' five' } },
  { type: 'content_block_delta', delta: { text: ' six' } },
  { type: 'content_block_delta', delta: { text: ' seven' } },
  { type: 'content_block_delta', delta: { text: ' eight' } },
  // No content_block_stop, no message_stop — stream closes abruptly.
];

export const truncatedHandler = createSyncHandler(events);
