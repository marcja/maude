/**
 * src/lib/client/sseParser.ts
 *
 * Parses the Server-Sent Events stream emitted by the BFF /api/chat route.
 * Accepts `response.body` directly and yields strongly-typed SSEEvent objects.
 *
 * This is a pure client-side utility — it has no knowledge of Ollama, no
 * imports from src/lib/server/, and no side-effects beyond reading the stream.
 *
 * The parsing strategy mirrors the tokenStream function in modelAdapter.ts:
 * accumulate a text buffer across reads, split on newlines, process complete
 * lines. This correctly handles events whose JSON payload arrives split across
 * multiple chunk boundaries.
 */

import type { SSEEvent } from './events';

/**
 * Read a `ReadableStream<Uint8Array>` (i.e. `response.body`) and yield each
 * complete SSE event as a typed SSEEvent. The generator returns naturally when:
 *   - the stream closes (all chunks consumed), or
 *   - a `data: [DONE]` sentinel is encountered.
 *
 * Non-`data:` lines (blank lines, `: keep-alive` comments) are silently skipped.
 * Malformed JSON payloads are skipped so a single bad line cannot kill the stream.
 */
export async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  // stream: true tells the decoder to hold incomplete multi-byte sequences
  // across calls, which matters for UTF-8 encoded non-ASCII model output.
  const decoder = new TextDecoder('utf-8', { fatal: false });
  // Accumulates text that arrived without a trailing newline — i.e., a partial
  // SSE line that will be completed by the next chunk.
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // The last element is either empty (line ended with \n) or an incomplete
      // line that needs more bytes. Either way, keep it as the new buffer.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Blank lines and SSE comment lines (": ...") are spec-legal separators.
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice('data:'.length).trim();

        // [DONE] is the OpenAI-style end-of-stream sentinel. The BFF emits it
        // after message_stop so clients that check for it stop reading cleanly.
        if (payload === '[DONE]') return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          // A malformed line (e.g. truncated JSON during a connection reset)
          // must not crash the consumer — skip and continue reading.
          continue;
        }

        // Only yield objects that have a string 'type' field — this filters out
        // non-event payloads (e.g. plain strings, arrays). Unknown 'type' values
        // are yielded as-is for forward-compatibility: consumers use exhaustive
        // switch/case, so unrecognised types fall through to no-ops harmlessly.
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'type' in parsed &&
          typeof (parsed as Record<string, unknown>).type === 'string'
        ) {
          // The BFF controls the SSE format, so the shape reliably matches the
          // discriminated union for all currently-defined event types.
          yield parsed as SSEEvent;
        }
      }
    }
  } finally {
    // Always release the reader lock, even when the consumer breaks out early
    // (e.g., an AbortController cancels the stream mid-flight).
    reader.releaseLock();
  }
}
