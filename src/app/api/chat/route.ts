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
// Request validation — "validate at boundaries, trust internally"
// ---------------------------------------------------------------------------

/**
 * Validate the raw JSON body from the client. This is the system boundary:
 * everything downstream (promptBuilder, modelAdapter, DB) can trust that the
 * data has the correct shape because validation happens here, once, up front.
 *
 * No Zod dependency — manual checks are simpler and keep the dependency tree
 * small. A production app with many endpoints would benefit from a schema
 * library; for a single route, manual validation is clearer and teaches the
 * underlying technique.
 */
function validateRequestBody(body: unknown): RequestBody {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const obj = body as Record<string, unknown>;

  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    throw new ValidationError('messages must be a non-empty array');
  }

  for (const msg of obj.messages) {
    if (typeof msg !== 'object' || msg === null) {
      throw new ValidationError('Each message must be an object');
    }
    const m = msg as Record<string, unknown>;
    if (m.role !== 'user' && m.role !== 'assistant') {
      throw new ValidationError("Each message role must be 'user' or 'assistant'");
    }
    if (typeof m.content !== 'string') {
      throw new ValidationError('Each message content must be a string');
    }
  }

  if (obj.conversationId !== undefined && obj.conversationId !== null) {
    if (typeof obj.conversationId !== 'string') {
      throw new ValidationError('conversationId must be a string or null');
    }
  }

  // After validation, the shape is guaranteed — this cast is safe.
  return {
    messages: obj.messages as ChatMessage[],
    conversationId: (obj.conversationId as string) ?? null,
  };
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
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
// Thinking-block streaming parser
// ---------------------------------------------------------------------------

// Parser states: 'content' emits to the visible response; 'thinking' emits
// to the hidden reasoning trace. The state machine handles tags that straddle
// token boundaries by buffering the potential tag suffix until the next token.
type StreamingParserState = 'content' | 'thinking';

type StreamingChunk =
  | { kind: 'thinking_start' }
  | { kind: 'thinking_stop' }
  | { kind: 'thinking'; text: string }
  | { kind: 'content'; text: string };

/**
 * Return the index in `buffer` at which a potential partial match of `tag`
 * begins. Everything before that index is safe to emit; the suffix must be
 * held back until the next token confirms or denies the tag.
 *
 * Example: buffer = "Hello <th", tag = "<think>" → returns 6 (hold "<th").
 */
function partialTagEnd(buffer: string, tag: string): number {
  // Walk backwards: check if the last k characters of buffer match the first
  // k characters of tag (1 ≤ k < tag.length). Stop at the longest match.
  for (let k = Math.min(tag.length - 1, buffer.length); k >= 1; k--) {
    if (buffer.endsWith(tag.slice(0, k))) {
      return buffer.length - k;
    }
  }
  return buffer.length;
}

/**
 * Process as much of `buffer` as can be safely emitted given the current
 * parser state. Returns emitted chunks, the new state, and any remaining
 * buffer that must be held until the next token arrives.
 */
function processBuffer(
  buffer: string,
  state: StreamingParserState
): { chunks: StreamingChunk[]; state: StreamingParserState; remaining: string } {
  const OPEN_TAG = '<think>';
  const CLOSE_TAG = '</think>';
  const chunks: StreamingChunk[] = [];
  let current = buffer;
  let currentState = state;

  while (current.length > 0) {
    if (currentState === 'content') {
      const idx = current.indexOf(OPEN_TAG);
      if (idx === -1) {
        // No complete open tag — hold back any partial tag suffix.
        const safeEnd = partialTagEnd(current, OPEN_TAG);
        if (safeEnd > 0) chunks.push({ kind: 'content', text: current.slice(0, safeEnd) });
        return { chunks, state: currentState, remaining: current.slice(safeEnd) };
      }
      if (idx > 0) chunks.push({ kind: 'content', text: current.slice(0, idx) });
      chunks.push({ kind: 'thinking_start' });
      currentState = 'thinking';
      current = current.slice(idx + OPEN_TAG.length);
    } else {
      const idx = current.indexOf(CLOSE_TAG);
      if (idx === -1) {
        const safeEnd = partialTagEnd(current, CLOSE_TAG);
        if (safeEnd > 0) chunks.push({ kind: 'thinking', text: current.slice(0, safeEnd) });
        return { chunks, state: currentState, remaining: current.slice(safeEnd) };
      }
      if (idx > 0) chunks.push({ kind: 'thinking', text: current.slice(0, idx) });
      chunks.push({ kind: 'thinking_stop' });
      currentState = 'content';
      current = current.slice(idx + CLOSE_TAG.length);
    }
  }
  return { chunks, state: currentState, remaining: '' };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // Validate at the boundary: request.json() returns `unknown`, so we validate
  // the shape before trusting it. Validation errors return 400 with a JSON body
  // (not an SSE stream) because the HTTP status hasn't been committed yet —
  // unlike model errors, which must be communicated as SSE events after 200.
  let body: RequestBody;
  try {
    body = validateRequestBody(await request.json());
  } catch (err) {
    if (err instanceof ValidationError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw err;
  }
  const { messages, conversationId: incomingConversationId } = body;

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

        // content_block_start is emitted lazily — only when the first content
        // chunk arrives. If the stream begins with a <think> block, we emit
        // thinking_block_start first so the client sees the correct ordering.
        let parserState: StreamingParserState = 'content';
        let parserBuffer = '';
        let contentBlockOpen = false;
        let thinkingBlockOpen = false;
        let accumulatedContent = '';
        let accumulatedThinking = '';

        for await (const token of tokens) {
          parserBuffer += token;
          const result = processBuffer(parserBuffer, parserState);
          parserState = result.state;
          parserBuffer = result.remaining;

          for (const chunk of result.chunks) {
            if (chunk.kind === 'thinking_start') {
              // Close any open content block before opening a thinking block.
              if (contentBlockOpen) {
                controller.enqueue(encode({ type: 'content_block_stop' }));
                contentBlockOpen = false;
              }
              controller.enqueue(encode({ type: 'thinking_block_start' }));
              thinkingBlockOpen = true;
            } else if (chunk.kind === 'thinking_stop') {
              controller.enqueue(encode({ type: 'thinking_block_stop' }));
              thinkingBlockOpen = false;
            } else if (chunk.kind === 'thinking') {
              accumulatedThinking += chunk.text;
              controller.enqueue(encode({ type: 'thinking_delta', delta: { text: chunk.text } }));
            } else {
              // Lazy content_block_start: open only when first content chunk arrives.
              if (!contentBlockOpen) {
                controller.enqueue(encode({ type: 'content_block_start' }));
                contentBlockOpen = true;
              }
              accumulatedContent += chunk.text;
              controller.enqueue(
                encode({ type: 'content_block_delta', delta: { text: chunk.text } })
              );
            }
          }
        }

        // Flush any partial tag held in the buffer at end-of-stream.
        if (parserBuffer.length > 0) {
          if (parserState === 'content') {
            if (!contentBlockOpen) {
              controller.enqueue(encode({ type: 'content_block_start' }));
              contentBlockOpen = true;
            }
            accumulatedContent += parserBuffer;
            controller.enqueue(
              encode({ type: 'content_block_delta', delta: { text: parserBuffer } })
            );
          } else {
            accumulatedThinking += parserBuffer;
            controller.enqueue(encode({ type: 'thinking_delta', delta: { text: parserBuffer } }));
          }
        }

        if (thinkingBlockOpen) controller.enqueue(encode({ type: 'thinking_block_stop' }));
        if (contentBlockOpen) controller.enqueue(encode({ type: 'content_block_stop' }));

        // Persist only on successful completion. If the signal fires mid-stream,
        // streamCompletion throws before this block is reached — no DB rows written.
        const now = Date.now();
        if (!incomingConversationId) {
          const title = firstUserContent.slice(0, 50) || 'New conversation';
          createConversation(conversationId, title, now);
        }
        const msgBase = { conversation_id: conversationId, created_at: now };
        insertMessage({
          ...msgBase,
          id: randomUUID(),
          role: 'user',
          content: firstUserContent,
          thinking: null,
        });
        insertMessage({
          ...msgBase,
          id: messageId,
          role: 'assistant',
          content: accumulatedContent,
          // Store the reasoning trace separately from visible content so the
          // DB schema mirrors Anthropic's thinking/content distinction.
          thinking: accumulatedThinking || null,
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
