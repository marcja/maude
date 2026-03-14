/**
 * tests/e2e/screenshots.spec.ts
 *
 * Takes screenshots of the chat UI in various states for visual review.
 * Not a permanent test — used for one-off visual QA.
 */

import { test } from '@playwright/test';
import { useMSWHandler } from './fixtures';

test.describe('Visual screenshots', () => {
  test('capture all UI states', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/chat');
    await useMSWHandler(page, 'normal');
    await page.waitForTimeout(1000);

    // 1. Both trays collapsed (default state)
    await page.screenshot({ path: 'screenshots/01-both-collapsed.png', fullPage: false });

    // 2. Expand left sidebar
    await page.click('[aria-label="Expand sidebar"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/02-left-expanded.png', fullPage: false });

    // 3. Both trays expanded
    await page.click('[aria-label="Expand debug pane"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/03-both-expanded.png', fullPage: false });

    // 4. Only right tray expanded
    await page.click('[aria-label="Collapse sidebar"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/04-right-expanded.png', fullPage: false });

    // 5. Debug pane — Metrics tab (default, empty)
    await page.screenshot({ path: 'screenshots/05-debug-metrics.png', fullPage: false });

    // 6. Debug pane — Events tab (empty)
    await page.click('role=tab[name="Events"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/06-debug-events.png', fullPage: false });

    // 7. Debug pane — Prompt tab (empty)
    await page.click('role=tab[name="Prompt"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/07-debug-prompt.png', fullPage: false });

    // 8. Collapse debug pane, send a message
    await page.click('[aria-label="Collapse debug pane"]');
    await page.waitForTimeout(300);
    await page.fill('[aria-label="Message input"]', 'Hello, how are you?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.message-list article', { timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/08-chat-with-messages.png', fullPage: false });

    // 9. Debug pane — Metrics tab (populated)
    await page.click('[aria-label="Expand debug pane"]');
    await page.waitForTimeout(500);
    await page.click('role=tab[name="Metrics"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/09-debug-metrics-populated.png', fullPage: false });

    // 10. Debug pane — Events tab (populated)
    await page.click('role=tab[name="Events"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/10-debug-events-populated.png', fullPage: false });

    // 11. Select a conversation from history to show the title header
    await page.click('[aria-label="Collapse debug pane"]');
    await page.waitForTimeout(300);
    await page.click('[aria-label="Expand sidebar"]');
    await page.waitForTimeout(500);
    // Click on a conversation in the history list
    const convItem = page.locator('[data-testid="conversation-item"]').first();
    await convItem.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/11-chat-with-title.png', fullPage: false });
  });

  test('thinking blocks and cancel/abort states', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    // 12. Thinking block — completed state (thinking handler is synchronous)
    await page.goto('/chat');
    await useMSWHandler(page, 'thinking');
    await page.waitForTimeout(500);
    await page.fill('[aria-label="Message input"]', 'What is the meaning of life?');
    await page.keyboard.press('Enter');
    // Wait for response to complete (thinking handler is sync, so it completes fast)
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/12-thinking-completed.png', fullPage: false });

    // 13. Thinking block — expand the collapsed thinking disclosure
    await page.click('.thinking-block__header');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/13-thinking-expanded.png', fullPage: false });

    // 14. Slow stream — Stop button visible mid-stream
    await page.goto('/chat');
    await useMSWHandler(page, 'slow');
    await page.waitForTimeout(500);
    await page.fill('[aria-label="Message input"]', 'Tell me a long story');
    await page.keyboard.press('Enter');
    // Wait for some tokens to arrive but stream still active
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/14-streaming-with-stop.png', fullPage: false });

    // 15. Click stop to cancel mid-stream
    await page.click('button:has-text("Stop")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/15-after-cancel.png', fullPage: false });

    // 16. Stall indicator — "Still working..." banner with Cancel button
    await page.goto('/chat');
    await useMSWHandler(page, 'stall');
    await page.waitForTimeout(500);
    await page.fill('[aria-label="Message input"]', 'This will stall');
    await page.keyboard.press('Enter');
    // Wait for stall threshold (8s) + buffer
    await page.waitForTimeout(9500);
    await page.screenshot({ path: 'screenshots/16-stall-indicator.png', fullPage: false });
  });
});
