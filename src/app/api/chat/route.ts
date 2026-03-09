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
import { createConversation, getSettings, insertMessage } from '../../../lib/server/db';
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
  // request.json() returns `unknown`. The `as RequestBody` cast trusts the
  // client to send valid data — acceptable here because this is an internal
  // BFF endpoint, not a public API. A production app would validate with Zod
  // or a manual check before trusting the shape (see commit 4 in the review).
  const { messages, conversationId: incomingConversationId } =
    (await request.json()) as RequestBody;

  const settings = getSettings();
  const systemPrompt = buildSystemPrompt(settings);
  // messageId doubles as the assistant message's DB id — generated once so the
  // message_start event and the DB row share the same identifier.
  const messageId = randomUUID();

  // Conversation ID: use the incoming one (continuation) or mint a new one.
  const conversationId = incomingConversationId ?? randomUUID();

  // First user message content: used for title generation and as the persisted user message body.
  const firstUserContent = messages.find((m) => m.role === 'user')?.content ?? '';

  // Push-based stream (start callback) rather than pull-based (pull callback):
  // the BFF re-emits tokens as fast as they arrive from the model adapter, so
  // there is no benefit to demand-driven pulling. A pull-based approach would
  // be appropriate if the producer were faster than the consumer and you wanted
  // to avoid buffering — not the case here since token rate is model-limited.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Always emit message_start first so the client can display the prompt
      // in the observability pane before the first token arrives.
      controller.enqueue(
        encode({ type: 'message_start', message_id: messageId, prompt_used: systemPrompt })
      );

      try {
        // Propagate the HTTP request's abort signal to Ollama so that clicking
        // Stop cancels the upstream fetch rather than just closing the SSE stream.
        const tokens = await streamCompletion(messages, systemPrompt, request.signal);

        // content_block_start signals "a text block is opening" to the client.
        // Emitted once before the first delta, not per-token.
        controller.enqueue(encode({ type: 'content_block_start' }));

        let accumulatedContent = '';
        for await (const token of tokens) {
          accumulatedContent += token;
          controller.enqueue(encode({ type: 'content_block_delta', delta: { text: token } }));
        }

        controller.enqueue(encode({ type: 'content_block_stop' }));

        // Persist only on successful completion. If the signal fires mid-stream,
        // streamCompletion throws before this block is reached — no DB rows written.
        const now = Date.now();
        if (!incomingConversationId) {
          const title = firstUserContent.slice(0, 50) || 'New conversation';
          createConversation(conversationId, title, now);
        }
        const msgBase = { conversation_id: conversationId, thinking: null, created_at: now };
        insertMessage({ ...msgBase, id: randomUUID(), role: 'user', content: firstUserContent });
        insertMessage({
          ...msgBase,
          id: messageId,
          role: 'assistant',
          content: accumulatedContent,
        });

        // Ollama's stream:true mode doesn't surface aggregate usage in the SSE
        // body; placeholder zeros here. A future task can fill real counts
        // if the model returns them in a final chunk.
        controller.enqueue(
          encode({ type: 'message_stop', usage: { input_tokens: 0, output_tokens: 0 } })
        );
      } catch (err) {
        // Abort is client-initiated; the client already knows it stopped, so
        // no error event is needed. DB writes are also skipped (not yet reached).
        if (!request.signal.aborted) {
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
        }
      } finally {
        controller.close();
      }
    },
  });

  // SSE responses always return 200. The HTTP status is committed before the
  // first token arrives, so server-side errors (model unreachable, bad response)
  // cannot change it retroactively. Errors are instead communicated as typed
  // SSE events within the stream body — the client's useStream hook handles
  // them via the 'error' case in its event switch.
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
