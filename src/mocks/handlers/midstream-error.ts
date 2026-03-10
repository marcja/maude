/**
 * src/mocks/handlers/midstream-error.ts
 *
 * MSW handler that simulates an error arriving mid-stream.
 * Emits one token ("Part") then an error event, leaving the stream
 * in a failed state with partial content visible.
 *
 * Used by useStream tests to verify error-state handling:
 * the hook must set error and clear isStreaming without losing partial tokens.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

const events: SSEEvent[] = [
  { type: 'message_start', message_id: 'test-msg-id' },
  { type: 'content_block_start' },
  { type: 'content_block_delta', delta: { text: 'Part' } },
  { type: 'error', error: { message: 'Stream failed', code: 'bad_response' } },
];

export const midstreamErrorHandler = createSyncHandler(events);
