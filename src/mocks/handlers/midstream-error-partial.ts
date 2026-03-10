/**
 * src/mocks/handlers/midstream-error-partial.ts
 *
 * MSW handler that emits 10 content tokens then an error event.
 * Unlike midstream-error.ts (1 token), this handler provides enough partial
 * content for Playwright to verify both the error display and token retention.
 *
 * Used by the M2 mid-stream error test.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

const events: SSEEvent[] = [
  { type: 'message_start', message_id: 'error-partial-test' },
  { type: 'content_block_start' },
  // `as const` preserves the string literal for SSEEvent's discriminated union —
  // Array.from() widens the type to string otherwise.
  ...Array.from({ length: 10 }, (_, i) => ({
    type: 'content_block_delta' as const,
    delta: { text: `word${i} ` },
  })),
  { type: 'error', error: { message: 'Stream failed', code: 'stream_error' } },
];

export const midstreamErrorPartialHandler = createSyncHandler(events);
