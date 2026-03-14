/**
 * @jest-environment node
 *
 * Tests for modelAdapter.ts environment variable parsing.
 *
 * These branches are evaluated at module load time, so each test must call
 * jest.resetModules() and re-require the module after setting process.env.
 * This file is separate from modelAdapter.test.ts because that file imports
 * the module at the top level (baking in default env var values).
 */

// Neutralise the server-only guard so the real module can load in plain Node.
jest.mock('server-only', () => ({}));

// Helpers
const SYSTEM_PROMPT = 'You are helpful.';
const USER_MESSAGES = [{ role: 'user' as const, content: 'Hi' }];

function sseChunk(...lines: string[]): Uint8Array {
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

function mockFetchResolving() {
  const mockFetch = jest.fn().mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(sseChunk('data: [DONE]'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    )
  );
  jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);
  return mockFetch;
}

async function collectAll(result: { tokens: AsyncIterable<string> }) {
  const out: string[] = [];
  for await (const t of result.tokens) out.push(t);
  return out;
}

// Save original env values so we can restore them after each test.
const originalEnv = { ...process.env };

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
  // Restore env vars to original values, removing any we added
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Suite: OLLAMA_BASE_URL default
// ---------------------------------------------------------------------------

describe('modelAdapter — OLLAMA_BASE_URL default', () => {
  it('uses http://host.docker.internal:11434 when OLLAMA_BASE_URL is unset', async () => {
    // biome-ignore lint/performance/noDelete: process.env assignment converts undefined to "undefined"; delete is required to truly unset env vars
    delete process.env.OLLAMA_BASE_URL;
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://host.docker.internal:11434/v1/chat/completions');
  });

  it('uses the provided OLLAMA_BASE_URL when set', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:9999';
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9999/v1/chat/completions');
  });
});

// ---------------------------------------------------------------------------
// Suite: MODEL_NAME default
// ---------------------------------------------------------------------------

describe('modelAdapter — MODEL_NAME default', () => {
  it('defaults to gpt-oss:20b when MODEL_NAME is unset', async () => {
    // biome-ignore lint/performance/noDelete: process.env assignment converts undefined to "undefined"; delete is required to truly unset env vars
    delete process.env.MODEL_NAME;
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe('gpt-oss:20b');
  });

  it('uses the provided MODEL_NAME when set', async () => {
    process.env.MODEL_NAME = 'llama3:8b';
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe('llama3:8b');
  });
});

// ---------------------------------------------------------------------------
// Suite: THINK_LEVEL parsing
// ---------------------------------------------------------------------------

describe('modelAdapter — THINK_LEVEL parsing', () => {
  it('sends boolean true when THINK_LEVEL is "true"', async () => {
    process.env.THINK_LEVEL = 'true';
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { think: string | boolean };
    expect(body.think).toBe(true);
  });

  it('sends boolean false when THINK_LEVEL is "false"', async () => {
    process.env.THINK_LEVEL = 'false';
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { think: string | boolean };
    expect(body.think).toBe(false);
  });

  it('passes through the raw string when THINK_LEVEL is a level like "high"', async () => {
    process.env.THINK_LEVEL = 'high';
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { think: string | boolean };
    expect(body.think).toBe('high');
  });

  it('defaults to "medium" when THINK_LEVEL is unset', async () => {
    // biome-ignore lint/performance/noDelete: process.env assignment converts undefined to "undefined"; delete is required to truly unset env vars
    delete process.env.THINK_LEVEL;
    const mockFetch = mockFetchResolving();
    const { streamCompletion } = require('../modelAdapter') as typeof import('../modelAdapter');

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collectAll(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { think: string | boolean };
    expect(body.think).toBe('medium');
  });
});
