/**
 * tests/e2e/chat-m4.spec.ts
 *
 * Playwright M4 test suite — proves the three-column layout (HistoryPane +
 * Chat + ObservabilityPane) works end-to-end.
 *
 * Tests:
 *   1. History loading: activate conversation handlers, click a conversation
 *      in the history pane, verify messages appear in chat, send a new message
 *      and verify the request body includes prior messages as context.
 *   2. Both panes collapse/expand; center fills available width.
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
  await page.getByRole('button', { name: 'Expand history pane' }).click();

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

// ---------------------------------------------------------------------------
// Test 2 — Both panes collapse/expand; center fills width
// ---------------------------------------------------------------------------

test('both panes collapse and expand; center fills available width', async ({ page }) => {
  await page.goto('/chat');
  await useMSWHandler(page, 'conversations');

  const centerSelector = '.chat-page';

  // Both panes start collapsed — measure baseline center width.
  const bothCollapsedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );

  // Expand the history pane.
  await page.getByRole('button', { name: 'Expand history pane' }).click();
  await expect(page.getByText('First conversation')).toBeVisible({ timeout: 5000 });

  // Center should be narrower with history pane expanded.
  const historyExpandedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(historyExpandedWidth).toBeLessThan(bothCollapsedWidth);

  // Expand the debug pane too.
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();
  await expect(page.getByRole('tab', { name: 'Metrics' })).toBeVisible({ timeout: 3000 });

  // Center should be even narrower with both panes expanded.
  const bothExpandedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(bothExpandedWidth).toBeLessThan(historyExpandedWidth);

  // Collapse the history pane — center should widen.
  await page.getByRole('button', { name: 'Collapse history pane' }).click();
  const historyCollapsedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(historyCollapsedWidth).toBeGreaterThan(bothExpandedWidth);

  // Collapse the debug pane — center should be back to full width.
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();
  await expect(page.getByText('Debug')).toBeVisible({ timeout: 2000 });

  const finalWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(finalWidth).toBeGreaterThan(historyCollapsedWidth);
});
