/**
 * tests/e2e/settings.spec.ts
 *
 * Playwright E2E tests for the Settings page.
 *
 * The settings page is a server component that reads directly from SQLite,
 * so MSW cannot intercept the initial load. These tests work with the real
 * database, resetting settings to empty before each test via POST /api/settings.
 */

import { expect, test } from './fixtures';

// Tests share a real SQLite database, so they must run serially to avoid
// cross-test pollution (e.g. Test 1's save leaking into Test 2's reload).
test.describe.configure({ mode: 'serial' });

// Reset settings to empty before each test so tests start with clean state.
// Uses the real POST /api/settings endpoint (no MSW interception).
test.beforeEach(async ({ request }) => {
  await request.post('/api/settings', {
    data: { name: '', personalizationPrompt: '' },
  });
});

// ---------------------------------------------------------------------------
// Test 1 — Load, edit, save, success feedback
// ---------------------------------------------------------------------------

test('settings: load, edit, save, and see success feedback', async ({ page }) => {
  await page.goto('/settings');

  // Form loads immediately from server component — fields start empty
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

  // Wait for form to load
  const nameInput = page.getByLabel(/name/i);
  await expect(nameInput).toBeVisible({ timeout: 5000 });

  // Fill in and save
  await nameInput.fill('Diana');
  await page.getByLabel(/personalization/i).fill('Always explain your reasoning');
  await page.getByRole('button', { name: /save/i }).click();

  // Wait for success feedback to confirm save completed
  await expect(page.getByText(/settings saved/i)).toBeVisible({ timeout: 5000 });

  // Verify saved values are still visible immediately after save — before
  // any reload. React 19 resets forms after actions; the component must
  // update defaultValues so fields don't revert to stale values.
  await expect(page.getByLabel(/name/i)).toHaveValue('Diana');
  await expect(page.getByLabel(/personalization/i)).toHaveValue('Always explain your reasoning');

  // Reload the page — server component reads from SQLite, which now has
  // the saved values from the POST above.
  await page.reload();

  // Verify the saved values are still present
  await expect(page.getByLabel(/name/i)).toHaveValue('Diana', { timeout: 5000 });
  await expect(page.getByLabel(/personalization/i)).toHaveValue('Always explain your reasoning');
});

// ---------------------------------------------------------------------------
// Test 3 — Navigation back to chat
// ---------------------------------------------------------------------------

test('settings: "Back to chat" link navigates to /chat', async ({ page }) => {
  await page.goto('/settings');

  // Wait for page to load
  await expect(page.getByLabel(/name/i)).toBeVisible({ timeout: 5000 });

  // Click the "Back to chat" link
  await page.getByRole('link', { name: /chat/i }).click();

  // Should navigate to /chat
  await expect(page).toHaveURL(/\/chat/);
});
