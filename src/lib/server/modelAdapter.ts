/**
 * src/lib/server/modelAdapter.ts
 *
 * Thin abstraction over the Ollama OpenAI-compatible chat endpoint. This is
 * intentionally the ONLY file that reads OLLAMA_BASE_URL or MODEL_NAME —
 * swapping backends (e.g., adding a Docker model runner) is a one-file change.
 *
 * `import 'server-only'` is a Next.js App Router convention: the `server-only`
 * package throws a build-time error if any client bundle transitively imports
 * this module. It is a compile-time firewall enforced by the bundler, not a
 * runtime check. If you see "server-only" errors during build, trace the
 * import chain — a client component is importing something that reaches here.
 *
 * The adapter is responsible for:
 *   1. Sending the streaming POST request to Ollama
 *   2. Surfacing connection failures as typed ModelAdapterErrors (not generic
 *      Errors), so the BFF route can map error codes to specific SSE events
 *   3. Yielding raw token strings via an async generator — the adapter does
 *      NOT parse thinking tags or emit SSE events. It is a thin I/O wrapper;
 *      the BFF route (route.ts) owns all event semantics
 *
 * If you need to add thinking-tag logic, it belongs in route.ts, not here.
 * The adapter yields raw strings so the BFF controls the full event schema.
 */

import 'server-only';

// ---------------------------------------------------------------------------
// Configuration — the only place these env vars are read
// ---------------------------------------------------------------------------

// Defaults match the dev container's host.docker.internal alias for the host.
const BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';
const MODEL = process.env.MODEL_NAME ?? 'gpt-oss:20b';

// Controls the `think` parameter sent to Ollama. Models like DeepSeek-R1 and
// Qwen 3 accept boolean true/false; gpt-oss requires a level string
// ("low" | "medium" | "high") and ignores booleans. Default "medium" matches
// the default model (gpt-oss:20b). Set to "true"/"false" for boolean-mode models.
const THINK_RAW = process.env.THINK_LEVEL ?? 'medium';
const THINK: string | boolean =
  THINK_RAW === 'true' ? true : THINK_RAW === 'false' ? false : THINK_RAW;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Token usage from the model's final streaming chunk. */
export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Result of streamCompletion — separates the token iterable from the usage
 * summary so callers can consume tokens first, then read final usage.
 */
export interface StreamResult {
  tokens: AsyncIterable<string>;
  /** Available only after the tokens iterable is fully consumed. */
  getUsage(): StreamUsage | null;
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
): Promise<StreamResult> {
  // Prepend the system prompt as an OpenAI-style system message. Ollama's
  // /v1/chat/completions endpoint accepts the same message array format.
  const body = JSON.stringify({
    model: MODEL,
    stream: true,
    // Request token usage in the final streaming chunk (OpenAI-compatible option).
    stream_options: { include_usage: true },
    think: THINK, // Ollama thinking: boolean for DeepSeek/Qwen, level string for gpt-oss
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

  // Mutable slot for usage data, populated by tokenStream when it encounters
  // the final chunk containing usage. Exposed via getUsage() closure.
  let captured: StreamUsage | null = null;
  const onUsage = (u: StreamUsage) => {
    captured = u;
  };

  return {
    tokens: tokenStream(response.body, onUsage),
    getUsage: () => captured,
  };
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
 * When thinking is enabled, Ollama delivers reasoning via `delta.reasoning`
 * on its /v1/chat/completions endpoint (OpenAI uses `delta.reasoning_content`;
 * both are checked). This generator wraps those tokens in `<think>`/`</think>`
 * tags so the BFF's existing tag parser handles them transparently. Models
 * that inline tags directly in `delta.content` are unaffected.
 *
 * Lines that aren't `data:` prefixed (keep-alive comments, blank lines) are
 * silently skipped. An empty `content` value is also skipped — these are the
 * role-only frames that appear at the start of the stream.
 */
async function* tokenStream(
  body: ReadableStream<Uint8Array>,
  onUsage: (usage: StreamUsage) => void
): AsyncIterable<string> {
  // Read the body manually to avoid pulling in a Node stream adapter that
  // isn't needed in the edge runtime.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Buffer for text that arrived without a trailing newline (partial SSE line).
  let buffer = '';
  // Tracks whether we're inside a reasoning_content sequence so we can emit
  // balanced <think>/</think> wrappers across multiple SSE lines.
  let inReasoning = false;

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
        if (payload === '[DONE]') {
          // Close any open reasoning wrapper before ending the stream.
          if (inReasoning) yield '</think>';
          return;
        }

        let parsed: {
          choices?: {
            delta?: { content?: string; reasoning?: string; reasoning_content?: string };
          }[];
          // OpenAI-compatible usage in the final chunk (stream_options.include_usage).
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          parsed = JSON.parse(payload) as typeof parsed;
        } catch {
          // Malformed JSON line — skip rather than crash the whole stream.
          continue;
        }

        // Capture usage from the final chunk (sent when stream_options.include_usage is true).
        if (parsed.usage?.prompt_tokens != null && parsed.usage?.completion_tokens != null) {
          onUsage({
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
          });
        }

        const delta = parsed.choices?.[0]?.delta;
        // Ollama uses `reasoning`; OpenAI uses `reasoning_content`. Check both.
        const reasoningContent = delta?.reasoning ?? delta?.reasoning_content;
        const content = delta?.content;

        // Emit reasoning_content first (if present), wrapped in <think> tags.
        if (reasoningContent) {
          if (!inReasoning) {
            yield '<think>';
            inReasoning = true;
          }
          yield reasoningContent;
        }

        // Emit visible content, closing the reasoning wrapper if needed.
        if (content) {
          if (inReasoning) {
            yield '</think>';
            inReasoning = false;
          }
          yield content;
        }
      }
    }

    // Stream ended without [DONE] — close any open reasoning wrapper.
    if (inReasoning) yield '</think>';
  } finally {
    // Release the lock so the body can be garbage collected even if the
    // consumer breaks out of the for-await loop early (e.g., abort).
    reader.releaseLock();
  }
}
