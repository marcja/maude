/**
 * src/lib/client/events.ts
 *
 * Discriminated union of all SSE event types emitted by the BFF /api/chat route.
 * The BFF translates Ollama's OpenAI-compatible format INTO this Anthropic-style
 * schema, so client code never knows which backend is in use.
 *
 * Every client-side module that consumes the stream (sseParser, useStream,
 * ObservabilityContext) imports from here — one authoritative source of truth.
 */

export type SSEEvent =
  | {
      type: 'message_start';
      message_id: string;
      // The composed system prompt, emitted by the BFF so the observability
      // pane can display exactly what was sent to the model.
      prompt_used?: string;
    }
  | { type: 'thinking_block_start' }
  | { type: 'thinking_delta'; delta: { text: string } }
  | { type: 'thinking_block_stop' }
  | { type: 'content_block_start' }
  | { type: 'content_block_delta'; delta: { text: string } }
  | { type: 'content_block_stop' }
  | {
      type: 'message_stop';
      // Server returns the conversation ID so the client can track and pass it
      // back on subsequent turns — enables multi-turn conversation persistence.
      conversation_id: string;
      usage: { input_tokens: number; output_tokens: number };
    }
  | { type: 'error'; error: { message: string; code: string } };
