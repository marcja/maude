/**
 * src/lib/server/modelAdapter.ts
 *
 * Thin abstraction over the Ollama OpenAI-compatible chat endpoint. This is
 * intentionally the ONLY file that reads OLLAMA_BASE_URL or MODEL_NAME —
 * swapping backends (e.g., adding a Docker model runner) is a one-file change.
 *
 * The `server-only` import causes a build-time error if any client component
 * transitively imports this module — enforced by the Next.js bundler.
 *
 * The adapter is responsible for:
 *   1. Sending the streaming POST request to Ollama
 *   2. Surfacing connection failures as typed ModelAdapterErrors
 *   3. Yielding raw token strings from the SSE response body
 *
 * Thinking-tag detection (<think> / </think>) is intentionally NOT done here —
 * that logic lives in the BFF route so the adapter stays a thin I/O wrapper.
 */

import 'server-only';

// ---------------------------------------------------------------------------
// Configuration — the only place these env vars are read
// ---------------------------------------------------------------------------

// Defaults match the dev container's host.docker.internal alias for the host.
const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';
const MODEL = process.env.MODEL_NAME ?? 'gpt-oss:20b';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Typed error thrown by the adapter. The BFF route maps these codes to
 * appropriate SSE error events so the client can show actionable UI.
 */
export class ModelAdapterError extends Error {
  constructor(
    public readonly code: 'model_unreachable' | 'bad_response',
    message: string
  ) {
    super(message);
    this.name = 'ModelAdapterError';
  }
}

// ---------------------------------------------------------------------------
// Streaming request
// ---------------------------------------------------------------------------

/**
 * Open a streaming chat completion request and return an async iterable of
 * raw token strings. Each yielded string is the `content` field from an
 * Ollama delta; empty deltas (role-only frames) are skipped.
 *
 * @throws {ModelAdapterError} code='model_unreachable' if the fetch fails (no
 *   connection, DNS failure, Ollama not running).
 * @throws {ModelAdapterError} code='bad_response' if Ollama replies with a
 *   non-2xx status.
 */
export async function streamCompletion(
  messages: ChatMessage[],
  systemPrompt: string,
  signal: AbortSignal
): Promise<AsyncIterable<string>> {
  // Prepend the system prompt as an OpenAI-style system message. Ollama's
  // /v1/chat/completions endpoint accepts the same message array format.
  const body = JSON.stringify({
    model: MODEL,
    stream: true,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  });

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
  } catch (err) {
    // fetch() rejects on network-level failures (connection refused, DNS,
    // offline). Map to a domain error so callers don't inspect raw TypeError.
    throw new ModelAdapterError(
      'model_unreachable',
      `Cannot reach Ollama at ${BASE_URL}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    throw new ModelAdapterError('bad_response', `Ollama returned HTTP ${response.status}`);
  }

  // response.body is always present when Ollama returns stream:true with a 2xx
  // status. Guard here (before calling the generator) so the error is thrown
  // eagerly in streamCompletion rather than lazily on first iteration.
  if (!response.body) {
    throw new ModelAdapterError('bad_response', 'Ollama response has no body');
  }

  // Return the generator without await — the caller drives consumption.
  return tokenStream(response.body);
}

// ---------------------------------------------------------------------------
// Private: SSE token generator
// ---------------------------------------------------------------------------

/**
 * Reads a ReadableStream of SSE bytes and yields token strings. Accepts the
 * raw stream (not the full Response) so it has no dependency on fetch or
 * ModelAdapterError — it is a pure stream-to-token transformer.
 *
 * Ollama streams OpenAI-compatible chunks:
 *   data: {"choices":[{"delta":{"content":"hello"}}]}
 *   data: [DONE]
 *
 * Lines that aren't `data:` prefixed (keep-alive comments, blank lines) are
 * silently skipped. An empty `content` value is also skipped — these are the
 * role-only frames that appear at the start of the stream.
 */
async function* tokenStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  // Read the body manually to avoid pulling in a Node stream adapter that
  // isn't needed in the edge runtime.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Buffer for text that arrived without a trailing newline (partial SSE line).
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete lines. Lines are separated by \n in Ollama's SSE.
      const lines = buffer.split('\n');
      // The last element may be an incomplete line — keep it in the buffer.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice('data:'.length).trim();
        if (payload === '[DONE]') return;

        let parsed: { choices?: { delta?: { content?: string } }[] };
        try {
          parsed = JSON.parse(payload) as typeof parsed;
        } catch {
          // Malformed JSON line — skip rather than crash the whole stream.
          continue;
        }

        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  } finally {
    // Release the lock so the body can be garbage collected even if the
    // consumer breaks out of the for-await loop early (e.g., abort).
    reader.releaseLock();
  }
}
