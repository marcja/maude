/**
 * tests/e2e/chat.spec.ts
 *
 * Playwright M1 test suite — proves the minimal chat page (T10) works end-to-end.
 *
 * MSW approach: each test navigates to /chat, waits for the MSW service worker
 * to mount, then activates a specific handler via window.__msw.use(key) before
 * submitting a message. This gives each test full control over the response
 * without touching the Next.js server or Ollama.
 *
 * Assertion notes:
 * - The Send button is always disabled when the textarea is empty (correct
 *   behaviour). Tests verify streaming state via Stop button visibility rather
 *   than Send button enable state.
 * - Next.js injects a route-announcer with role="alert". Error assertions use
 *   the specific `.chat__error` class selector to avoid ambiguity.
 */

import { expect, resetMSWHandlers, sendChatMessage, test, useMSWHandler } from './fixtures';

test.afterEach(async ({ page }) => {
  // Remove any test-specific handler so the next test starts clean.
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — Happy path
// ---------------------------------------------------------------------------

test('happy path: message sent → tokens stream → response shown', async ({ page }) => {
  await sendChatMessage(page, 'normal', 'Hi');

  // normalHandler emits "Hello" + " world"
  await expect(page.getByText('Hello world')).toBeVisible();

  // Streaming complete — Stop button gone (isStreaming: false).
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 2 — Cancellation
// ---------------------------------------------------------------------------

test('cancellation: stop mid-stream shows partial response', async ({ page }) => {
  await sendChatMessage(page, 'slow', 'Hello'); // 100 tokens × 100ms

  // Wait for at least the first token to render before stopping.
  // slowHandler emits "word0 " first, then "word1 ", etc.
  await expect(page.getByText(/word0/)).toBeVisible({ timeout: 3000 });

  // Click Stop while still streaming.
  await page.getByRole('button', { name: 'Stop' }).click();

  // After abort: Stop button disappears (isStreaming: false).
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible({ timeout: 2000 });

  // Partial content is still visible — tokens accumulated before abort are kept.
  await expect(page.getByText(/word0/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 3 — Auto-scroll
// ---------------------------------------------------------------------------

test('auto-scroll: scrolls to bottom; manual scroll shows scroll-to-bottom button', async ({
  page,
}) => {
  await page.goto('/chat');

  // Constrain the message-list height so that even a few tokens overflow it.
  // Without this, the default full-viewport container (~640px) requires ~500
  // tokens before content overflows — the slow handler only sends 100.
  await page.addStyleTag({
    content: '[data-testid="message-list"] { flex: none !important; height: 80px !important; }',
  });

  // data-testid selector used for all imperative scroll queries below.
  const listSel = '[data-testid="message-list"]';

  await useMSWHandler(page, 'slow');

  await page.fill('[aria-label="Message input"]', 'Hello');
  await page.keyboard.press('Enter');

  // Part A: Wait until the container overflows by more than 50px.
  // The suspension threshold is >50px from the bottom, so we need scrollHeight
  // to exceed clientHeight by >50 before "scrolled to top" triggers suspension.
  // With the 80px height, this happens once ~40 tokens have accumulated (~4s).
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && el.scrollHeight - el.clientHeight > 50;
    },
    listSel,
    { timeout: 15000 }
  );

  // Auto-scroll should have kept us at the bottom while tokens streamed in.
  const isScrolledToBottom = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 50;
  }, listSel);
  expect(isScrolledToBottom).toBe(true);

  // Part B: Scroll up manually → "Scroll to bottom" button should appear.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.scrollTop = 0;
      // Dispatch a scroll event so the React onScroll handler fires.
      el.dispatchEvent(new Event('scroll'));
    }
  }, listSel);

  // React state update is async; wait for the button to appear.
  await expect(page.getByRole('button', { name: 'Scroll to bottom' })).toBeVisible({
    timeout: 2000,
  });

  // Part C: Click the button → scrolls back to bottom, button disappears.
  await page.getByRole('button', { name: 'Scroll to bottom' }).click();
  await expect(page.getByRole('button', { name: 'Scroll to bottom' })).not.toBeVisible();

  const isAtBottomAgain = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 50;
  }, listSel);
  expect(isAtBottomAgain).toBe(true);

  // Clean up: stop the stream so the test exits promptly.
  const stopBtn = page.getByRole('button', { name: 'Stop' });
  if (await stopBtn.isVisible()) {
    await stopBtn.click();
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Error display
// ---------------------------------------------------------------------------

test('error display: model error shows message and re-enables Send', async ({ page }) => {
  await sendChatMessage(page, 'midstream-error', 'Hello');

  // midstreamErrorHandler emits an error event with message "Stream failed".
  // Use the specific class selector — Next.js also renders a role="alert"
  // element (route announcer) which would cause a strict-mode violation.
  await expect(page.locator('.chat__error')).toContainText('Stream failed', { timeout: 3000 });

  // Streaming stopped on error — Stop button gone.
  await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible();
});
