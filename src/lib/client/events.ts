/**
 * src/lib/client/events.ts
 *
 * Discriminated union of all SSE event types emitted by the BFF /api/chat route.
 * This is the API contract between the BFF (producer) and all client-side
 * consumers (sseParser, useStream, ObservabilityContext).
 *
 * The BFF translates Ollama's OpenAI-compatible format INTO this Anthropic-
 * inspired schema, so client code never knows which backend is in use. The
 * event names (message_start, content_block_delta, etc.) are inspired by the
 * Anthropic Messages API but simplified — they do not match a real Anthropic
 * API exactly.
 *
 * Adding a new event type requires changes in four places:
 *   1. This file — add the new variant to the SSEEvent union
 *   2. route.ts — emit the new event in the BFF streaming logic
 *   3. sseParser.ts — no change needed (it passes through any object with a
 *      string `type` field)
 *   4. useStream.ts — handle the new event in the switch/case consumer
 *
 * The discriminated union enables exhaustive switch statements in consumers:
 * TypeScript will flag unhandled event types at compile time if a new variant
 * is added here but not handled in useStream's switch/case.
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
