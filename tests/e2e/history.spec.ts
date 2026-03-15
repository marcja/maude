/**
 * tests/e2e/history.spec.ts
 *
 * History pane E2E tests — loading conversations from the API and
 * reconstituting prior messages as context for new requests.
 *
 * Tests:
 *   1. History loading: activate conversation handlers, click a conversation
 *      in the history pane, verify messages appear in chat, send a new message
 *      and verify the request body includes prior messages as context.
 */

import { expect, resetMSWHandlers, test, useMSWHandler } from './fixtures';

test.afterEach(async ({ page }) => {
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — History loading + context reconstitution
// ---------------------------------------------------------------------------

test('history pane: load conversation, send message with prior context', async ({ page }) => {
  await page.goto('/chat');

  // Activate conversation API handlers (list + detail + delete) and the
  // normal chat handler so we can both browse history and send messages.
  await useMSWHandler(page, 'conversations');
  await useMSWHandler(page, 'normal');

  // Expand the history pane (starts collapsed by default).
  // aria-label is "Expand sidebar" (generic label on the left pane;
  // the right debug pane uses "Expand debug pane").
  await page.getByRole('button', { name: 'Expand sidebar' }).click();

  // Wait for conversations to load from the mock API.
  await expect(page.getByText('First conversation')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Second conversation')).toBeVisible({ timeout: 5000 });

  // Click the first conversation to load its messages into the chat.
  await page.getByText('First conversation').click();

  // The fixture messages for conv-1: user "Hello there", assistant "Hi! How can I help?"
  await expect(page.getByText('Hello there')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Hi! How can I help?')).toBeVisible({ timeout: 5000 });

  // Now send a new message and capture the request to verify prior context.
  // Use waitForRequest (event listener) rather than page.route — MSW's service
  // worker intercepts before Playwright's route handler, so page.route never
  // sees the body.
  const requestPromise = page.waitForRequest('**/api/chat');

  await page.fill('[aria-label="Message input"]', 'Follow-up question');
  await page.keyboard.press('Enter');

  const chatRequest = await requestPromise;
  const capturedBody = JSON.parse(chatRequest.postData() ?? '{}') as {
    messages?: Array<{ role: string; content: string }>;
  };

  // Wait for the streaming response to appear (proves the request went through).
  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });

  // Verify the request body included the loaded history as context.
  expect(capturedBody.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Hello there' }),
      expect.objectContaining({ role: 'assistant', content: 'Hi! How can I help?' }),
      expect.objectContaining({ role: 'user', content: 'Follow-up question' }),
    ])
  );
});
