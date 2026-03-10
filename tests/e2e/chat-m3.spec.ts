/**
 * tests/e2e/chat-m3.spec.ts
 *
 * Playwright M3 test suite — proves the ObservabilityPane integration works
 * end-to-end alongside the chat UI in the two-column layout.
 *
 * Tests:
 *   1. Metrics + Events + copy event: two conversations produce two metrics
 *      cards, events show complete sequence, copy emits response_copied
 *   2. System Prompt tab: handler with Alice prompt_used → tab shows "Alice"
 *   3. Pane collapse/expand: pane collapses to strip, center fills width
 */

import { expect, resetMSWHandlers, sendChatMessage, test, useMSWHandler } from './fixtures';

test.afterEach(async ({ page }) => {
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — Metrics + Events + copy event
// ---------------------------------------------------------------------------

test('observability pane: two conversations, metrics cards, events, copy event', async ({
  page,
}) => {
  // Navigate once and keep the page alive for both conversations so
  // ObservabilityContext accumulates state across both.
  await page.goto('/chat');
  await useMSWHandler(page, 'normal');

  // First conversation
  await page.fill('[aria-label="Message input"]', 'Hi');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });

  // Wait for streaming to finish (Stop button disappears).
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible({ timeout: 3000 });

  // Start a new chat and send a second message.
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.fill('[aria-label="Message input"]', 'Hi again');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible({ timeout: 3000 });

  // Open the debug pane via gear button.
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();

  // Metrics tab (default) should show 2 cards — one per conversation.
  await expect(page.locator('[data-testid="metrics-card"]')).toHaveCount(2, { timeout: 3000 });

  // Events tab should include stream_completed events.
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(
    page.locator('[data-testid="event-type"]').filter({ hasText: 'stream_completed' }).first()
  ).toBeVisible({ timeout: 3000 });

  // Click Copy on an assistant message to trigger response_copied event.
  await page.getByRole('button', { name: 'Copy response' }).first().click();

  // The Events tab should now show a response_copied event.
  await expect(
    page.locator('[data-testid="event-type"]').filter({ hasText: 'response_copied' })
  ).toBeVisible({ timeout: 3000 });
});

// ---------------------------------------------------------------------------
// Test 2 — System Prompt tab shows Alice
// ---------------------------------------------------------------------------

test('system prompt tab: displays prompt_used value from SSE stream', async ({ page }) => {
  await sendChatMessage(page, 'normal-alice', 'Hello');
  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });

  // Open debug pane and switch to System Prompt tab.
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();
  await page.getByRole('tab', { name: 'System Prompt' }).click();

  // The pre block should contain Alice from the handler's prompt_used.
  await expect(page.locator('[data-testid="system-prompt-pre"]')).toContainText('Alice', {
    timeout: 3000,
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Pane collapse/expand + center width
// ---------------------------------------------------------------------------

test('pane collapses and expands; center fills width when collapsed', async ({ page }) => {
  await page.goto('/chat');

  // Open the debug pane.
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();

  // Pane should be expanded — tab bar visible.
  await expect(page.getByRole('tab', { name: 'Metrics' })).toBeVisible({ timeout: 3000 });

  // Measure center column width while pane is expanded.
  const centerSelector = '.chat-page';
  const expandedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );

  // Collapse the pane via the gear toggle in the chat header.
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();

  // Collapsed strip shows vertical "Debug" text.
  await expect(page.getByText('Debug')).toBeVisible({ timeout: 2000 });

  // Center column should be wider now that the pane is collapsed.
  const collapsedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(collapsedWidth).toBeGreaterThan(expandedWidth);

  // Expand the pane again.
  await page.getByRole('button', { name: 'Expand debug pane' }).click();
  await expect(page.getByRole('tab', { name: 'Metrics' })).toBeVisible({ timeout: 2000 });
});
