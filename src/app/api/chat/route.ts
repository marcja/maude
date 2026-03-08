/**
 * src/app/api/chat/route.ts
 *
 * BFF (Backend-for-Frontend) POST handler for /api/chat.
 *
 * The client never calls Ollama directly. This route:
 *   1. Reads user settings from SQLite
 *   2. Composes a system prompt via promptBuilder
 *   3. Streams tokens from the model adapter
 *   4. Translates Ollama's OpenAI-compatible format into the app's
 *      Anthropic-style SSE schema (see src/lib/client/events.ts)
 *   5. Emits events as a Server-Sent Events response body
 *
 * T05 scope: happy path only. Abort propagation and DB persistence are
 * wired in T09.
 */

import { randomUUID } from 'node:crypto';
import type { SSEEvent } from '../../../lib/client/events';
import { getSettings } from '../../../lib/server/db';
import { ModelAdapterError, streamCompletion } from '../../../lib/server/modelAdapter';
import type { ChatMessage } from '../../../lib/server/modelAdapter';
import { buildSystemPrompt } from '../../../lib/server/promptBuilder';

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

interface RequestBody {
  messages: ChatMessage[];
  // conversationId is carried through for T09 (DB persistence). Unused here.
  conversationId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Serialize an SSEEvent to the wire format:
 *   data: <json>\n\n
 *
 * The double newline is the SSE event separator; sseParser.ts splits on it.
 */
function encode(event: SSEEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const { messages } = (await request.json()) as RequestBody;

  const settings = getSettings();
  const systemPrompt = buildSystemPrompt(settings);
  const messageId = randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Always emit message_start first so the client can display the prompt
      // in the observability pane before the first token arrives.
      controller.enqueue(
        encode({ type: 'message_start', message_id: messageId, prompt_used: systemPrompt })
      );

      try {
        // T09 replaces new AbortController().signal with request.signal once
        // abort propagation is wired end-to-end.
        const tokens = await streamCompletion(messages, systemPrompt, new AbortController().signal);

        // content_block_start signals "a text block is opening" to the client.
        // Emitted once before the first delta, not per-token.
        controller.enqueue(encode({ type: 'content_block_start' }));

        for await (const token of tokens) {
          controller.enqueue(encode({ type: 'content_block_delta', delta: { text: token } }));
        }

        controller.enqueue(encode({ type: 'content_block_stop' }));

        // Ollama's stream:true mode doesn't surface aggregate usage in the SSE
        // body; placeholder zeros here. T09 / a future task can fill real counts
        // if the model returns them in a final chunk.
        controller.enqueue(
          encode({ type: 'message_stop', usage: { input_tokens: 0, output_tokens: 0 } })
        );
      } catch (err) {
        const isAdapterError = err instanceof ModelAdapterError;
        controller.enqueue(
          encode({
            type: 'error',
            error: {
              message: err instanceof Error ? err.message : String(err),
              // Use the typed adapter code when available so the client can
              // show a specific error (e.g. "model unreachable" vs generic).
              code: isAdapterError ? err.code : 'unknown',
            },
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      // Prevent buffering by proxies and the browser's fetch layer.
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
