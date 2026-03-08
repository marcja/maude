/**
 * src/mocks/utils.ts
 *
 * Shared utilities for MSW handler implementations.
 * Kept in a separate file so every handler that serialises SSE events uses
 * the same format and any future format change is a one-line fix.
 */

import type { SSEEvent } from '../lib/client/events';

/**
 * Serialise an SSEEvent into a complete SSE line ready for enqueueing into a
 * ReadableStream. The BFF route uses the same `data: <json>\n\n` format so
 * handlers produce byte-for-byte identical output to the production server.
 */
export function encodeEvent(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
