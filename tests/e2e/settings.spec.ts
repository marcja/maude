/**
 * tests/e2e/settings.spec.ts
 *
 * Playwright E2E tests for the Settings page (T24).
 *
 * Tests:
 *   1. Load settings → edit → save → success feedback shown
 *   2. Saved values persist on reload (MSW handlers use in-memory state)
 *   3. Navigation: "Back to chat" link works
 */

import { expect, resetMSWHandlers, test, useMSWHandler } from './fixtures';

test.afterEach(async ({ page }) => {
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — Load, edit, save, success feedback
// ---------------------------------------------------------------------------

test('settings: load, edit, save, and see success feedback', async ({ page }) => {
  await page.goto('/settings');
  await useMSWHandler(page, 'settings');

  // Wait for form to load (name input visible and empty by default)
  const nameInput = page.getByLabel(/name/i);
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await expect(nameInput).toHaveValue('');

  // Fill in settings
  await nameInput.fill('Charlie');
  await page.getByLabel(/personalization/i).fill('Be concise and direct');

  // Save
  await page.getByRole('button', { name: /save/i }).click();

  // Success feedback should appear
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 2 — Saved values persist on reload
// ---------------------------------------------------------------------------

test('settings: saved values persist on reload', async ({ page }) => {
  await page.goto('/settings');
  await useMSWHandler(page, 'settings');

  // Wait for form to load
  const nameInput = page.getByLabel(/name/i);
  await expect(nameInput).toBeVisible({ timeout: 5000 });

  // Fill in and save
  await nameInput.fill('Diana');
  await page.getByLabel(/personalization/i).fill('Always explain your reasoning');
  await page.getByRole('button', { name: /save/i }).click();

  // Wait for success feedback to confirm save completed
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5000 });

  // Reload the page — MSW handlers retain in-memory state so the saved
  // values should be returned by the GET request on mount.
  await page.reload();
  await useMSWHandler(page, 'settings');

  // Verify the saved values are still present
  await expect(page.getByLabel(/name/i)).toHaveValue('Diana', { timeout: 5000 });
  await expect(page.getByLabel(/personalization/i)).toHaveValue('Always explain your reasoning');
});

// ---------------------------------------------------------------------------
// Test 3 — Navigation back to chat
// ---------------------------------------------------------------------------

test('settings: "Back to chat" link navigates to /chat', async ({ page }) => {
  await page.goto('/settings');
  await useMSWHandler(page, 'settings');

  // Wait for page to load
  await expect(page.getByLabel(/name/i)).toBeVisible({ timeout: 5000 });

  // Click the "Back to chat" link
  await page.getByRole('link', { name: /chat/i }).click();

  // Should navigate to /chat
  await expect(page).toHaveURL(/\/chat/);
});
