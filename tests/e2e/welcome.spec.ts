/**
 * tests/e2e/welcome.spec.ts
 *
 * Playwright E2E tests for the Welcome page (T25).
 *
 * Tests:
 *   1. "Start chatting" link navigates to /chat
 *   2. Settings link navigates to /settings
 *   3. Settings injection end-to-end: set name → chat → System Prompt tab shows name
 */

import { expect, resetMSWHandlers, test, useMSWHandler } from './fixtures';

test.afterEach(async ({ page }) => {
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — "Start chatting" navigates to /chat
// ---------------------------------------------------------------------------

test('welcome: "Start chatting" navigates to /chat', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: /start chatting/i }).click();

  await expect(page).toHaveURL(/\/chat/);
});

// ---------------------------------------------------------------------------
// Test 2 — Settings link navigates to /settings
// ---------------------------------------------------------------------------

test('welcome: settings link navigates to /settings', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: /settings/i }).click();

  await expect(page).toHaveURL(/\/settings/);
});

// ---------------------------------------------------------------------------
// Test 3 — Settings injection end-to-end
// ---------------------------------------------------------------------------

test('settings injection: set name → chat → System Prompt tab shows name', async ({ page }) => {
  // Step 1: Navigate to settings and set a name
  await page.goto('/settings');
  await useMSWHandler(page, 'settings');

  const nameInput = page.getByLabel(/name/i);
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill('Alice');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5000 });

  // Step 2: Navigate to chat and send a message using the normal-alice handler
  // (which includes prompt_used containing the name "Alice")
  await page.goto('/chat');
  await useMSWHandler(page, 'normal-alice');

  await page.fill('[aria-label="Message input"]', 'Hello');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 5000 });

  // Step 3: Open the debug pane and check System Prompt tab for "Alice"
  await page.getByRole('button', { name: 'Toggle debug pane' }).click();
  await page.getByRole('tab', { name: 'System Prompt' }).click();

  await expect(page.locator('[data-testid="system-prompt-pre"]')).toContainText('Alice', {
    timeout: 3000,
  });
});
