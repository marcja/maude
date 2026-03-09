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
  it('serialises an SSE event to the "data: <json>\\n\\n" format', () => {
    const event: SSEEvent = { type: 'content_block_start' };
    expect(encodeEvent(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });
});

describe('delay', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves after the specified duration', async () => {
    const promise = delay(500, new AbortController().signal);
    jest.advanceTimersByTime(500);
    // Promise should resolve without hanging — fake timer advanced past the delay.
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves early when the signal fires mid-wait', async () => {
    const controller = new AbortController();
    const promise = delay(10_000, controller.signal);
    // Abort fires before the 10s timer — delay should resolve immediately.
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
  });
});
