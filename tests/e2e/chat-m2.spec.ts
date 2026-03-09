/**
 * tests/e2e/chat-m2.spec.ts
 *
 * Playwright M2 test suite — proves Phase 2 streaming polish works end-to-end.
 *
 * Tests:
 *   1. Stall detection: "Still working…" appears after 8s silence, Cancel aborts
 *   2. Mid-stream error: partial content preserved, error + Retry shown
 *   3. Thinking blocks: ThinkingBlock renders, collapses, expands with content
 *   4. Markdown: fenced code block renders correctly
 */

import { expect, resetMSWHandlers, sendChatMessage, test } from './fixtures';

test.afterEach(async ({ page }) => {
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — Stall detection
// ---------------------------------------------------------------------------

test('stall detection: "Still working…" appears after 8s silence, Cancel aborts', async ({
  page,
}) => {
  // This test waits 8+ seconds for the stall threshold to fire.
  test.slow();

  await sendChatMessage(page, 'stall', 'Hello');

  // stallHandler emits "tok0 " through "tok4 " at 100ms intervals, then pauses 10s.
  await expect(page.getByText(/tok0/)).toBeVisible({ timeout: 5000 });

  // After 8s of silence, useStallDetection fires → StallIndicator appears.
  await expect(page.locator('.stall-indicator')).toContainText('Still working', { timeout: 15000 });

  // Click Cancel on the stall indicator to abort.
  await page.locator('.stall-indicator').getByRole('button', { name: 'Cancel' }).click();

  // Stop button gone (stream aborted).
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible({ timeout: 2000 });

  // Partial content from Phase 1 is preserved.
  await expect(page.getByText(/tok0/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 2 — Mid-stream error with partial content
// ---------------------------------------------------------------------------

test('mid-stream error: error bar shown with Retry button', async ({ page }) => {
  await sendChatMessage(page, 'midstream-error-partial', 'Hello');

  // Error event arrives after 10 tokens. The error bar should appear.
  await expect(page.locator('.chat__error')).toContainText('Stream failed', { timeout: 5000 });

  // Streaming stopped — Stop button gone.
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible();

  // Retry button is present in the error bar.
  await expect(page.locator('.chat__error').getByRole('button', { name: 'Retry' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 3 — Thinking blocks render and collapse
// ---------------------------------------------------------------------------

test('thinking blocks: ThinkingBlock renders, collapses, and expands', async ({ page }) => {
  await sendChatMessage(page, 'thinking', 'Think');

  // thinkingHandler emits thinking deltas then "The answer is 42."
  await expect(page.getByText('The answer is 42.')).toBeVisible({ timeout: 5000 });

  // ThinkingBlock should be visible with "Thought for" in the header.
  const thinkingBlock = page.locator('.thinking-block');
  await expect(thinkingBlock).toBeVisible();
  await expect(thinkingBlock.locator('.thinking-block__header')).toContainText('Thought for');

  // Content is collapsed by default — the content div should not be visible.
  await expect(thinkingBlock.locator('.thinking-block__content')).not.toBeVisible();

  // Click header to expand.
  await thinkingBlock.locator('.thinking-block__header').click();
  await expect(thinkingBlock.locator('.thinking-block__content')).toBeVisible();
  await expect(thinkingBlock.locator('.thinking-block__content')).toContainText('Step 1');
});

// ---------------------------------------------------------------------------
// Test 4 — Markdown code block
// ---------------------------------------------------------------------------

test('markdown: fenced code block renders correctly', async ({ page }) => {
  await sendChatMessage(page, 'markdown', 'Code');

  // markdownHandler emits content with a JS code fence then "Done."
  await expect(page.getByText('Done.')).toBeVisible({ timeout: 5000 });

  // The code fence should render as a <code> element containing the source.
  await expect(page.locator('code').filter({ hasText: 'const x = 42' })).toBeVisible();
});
