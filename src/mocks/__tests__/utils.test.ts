/**
 * src/mocks/__tests__/utils.test.ts
 *
 * Tests for the shared MSW handler utilities: encodeEvent and delay.
 * encodeEvent is already exercised indirectly by handler tests; these tests
 * cover delay's abort-signal path which only runs in real-time E2E scenarios.
 */

import type { SSEEvent } from '../../lib/client/events';
import { delay, encodeEvent } from '../utils';

describe('encodeEvent', () => {
  it('when given an SSE event, formats it as a "data: <json>\\n\\n" string for streaming', () => {
    const event: SSEEvent = { type: 'content_block_start' };
    expect(encodeEvent(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it.each<{ label: string; event: SSEEvent }>([
    { label: 'content_block_delta', event: { type: 'content_block_delta', delta: { text: 'hi' } } },
    { label: 'error', event: { type: 'error', error: { message: 'fail', code: 'bad' } } },
    {
      label: 'message_stop',
      event: {
        type: 'message_stop',
        conversation_id: 'test-conv',
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    },
  ])('serialises $label with nested fields', ({ event }) => {
    expect(encodeEvent(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });
});

describe('delay', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('when the specified duration elapses, resolves the promise', async () => {
    const promise = delay(500, new AbortController().signal);
    jest.advanceTimersByTime(500);
    // Promise should resolve without hanging — fake timer advanced past the delay.
    await expect(promise).resolves.toBeUndefined();
  });

  it('when the abort signal fires mid-wait, resolves early', async () => {
    const controller = new AbortController();
    const promise = delay(10_000, controller.signal);
    // Abort fires before the 10s timer — delay should resolve immediately.
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
  });

  it('when the signal is already aborted before delay() is called, resolves immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    // Signal is already aborted before delay() is called — must not wait.
    const promise = delay(10_000, controller.signal);
    await expect(promise).resolves.toBeUndefined();
  });
});
