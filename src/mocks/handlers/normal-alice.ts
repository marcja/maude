/**
 * src/mocks/handlers/normal-alice.ts
 *
 * MSW handler identical to normalHandler but with a prompt_used value that
 * includes "Alice" — simulates the BFF having read name="Alice" from settings
 * and injected it via promptBuilder. Used by the M3 Playwright test to verify
 * the System Prompt tab displays the prompt_used value from the SSE stream.
 */

import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../handlerFactory';

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
  {
    type: 'message_stop',
    conversation_id: 'normal-alice.ts-conv',
    usage: { input_tokens: 5, output_tokens: 2 },
  },
];

export const normalAliceHandler = createSyncHandler(events);
