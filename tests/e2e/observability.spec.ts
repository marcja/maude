/**
 * tests/e2e/observability.spec.ts
 *
 * Observability pane E2E tests — metrics cards, event timeline, copy events,
 * and system prompt display.
 *
 * Tests:
 *   1. Metrics + Events + copy event: two conversations produce two metrics
 *      cards, events show complete sequence, copy emits response_copied
 *   2. System Prompt tab: handler with Alice prompt_used → tab shows "Alice"
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

  // Start a new chat via the sidebar's "New chat" icon button.
  // Scoped to <nav> to avoid ambiguity if expanded sidebar also shows "New chat".
  await page.getByRole('navigation').getByRole('button', { name: 'New chat' }).click();
  await page.fill('[aria-label="Message input"]', 'Hi again');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible({ timeout: 3000 });

  // Open the debug pane via the collapsed strip's expand button.
  await page.getByRole('button', { name: 'Expand debug pane' }).click();

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

  // Open debug pane and switch to Prompt tab.
  await page.getByRole('button', { name: 'Expand debug pane' }).click();
  await page.getByRole('tab', { name: 'Prompt' }).click();

  // The pre block should contain Alice from the handler's prompt_used.
  await expect(page.locator('[data-testid="system-prompt-pre"]')).toContainText('Alice', {
    timeout: 3000,
  });
});
