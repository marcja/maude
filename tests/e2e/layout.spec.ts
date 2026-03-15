/**
 * tests/e2e/layout.spec.ts
 *
 * Layout E2E tests — three-column grid, pane collapse/expand behavior,
 * and center column width adjustment.
 *
 * Tests:
 *   1. Debug pane collapse/expand: pane collapses to strip, center fills width
 *   2. Both panes collapse/expand: center fills available width
 */

import { expect, resetMSWHandlers, test, useMSWHandler } from './fixtures';

test.afterEach(async ({ page }) => {
  await resetMSWHandlers(page);
});

// ---------------------------------------------------------------------------
// Test 1 — Debug pane collapse/expand + center width
// ---------------------------------------------------------------------------

test('pane collapses and expands; center fills width when collapsed', async ({ page }) => {
  await page.goto('/chat');

  // Open the debug pane.
  await page.getByRole('button', { name: 'Expand debug pane' }).click();

  // Pane should be expanded — tab bar visible.
  await expect(page.getByRole('tab', { name: 'Metrics' })).toBeVisible({ timeout: 3000 });

  // Measure center column width while pane is expanded.
  const centerSelector = '.chat-page';
  const expandedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );

  // Collapse the pane via the collapse button inside the expanded pane header.
  await page.getByRole('button', { name: 'Collapse debug pane' }).click();

  // Collapsed strip shows the expand button.
  await expect(page.getByRole('button', { name: 'Expand debug pane' })).toBeVisible({
    timeout: 2000,
  });

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

  // Expand the history pane — "Expand sidebar" is the left pane's generic
  // label; the right debug pane uses "Expand debug pane".
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByText('First conversation')).toBeVisible({ timeout: 5000 });

  // Center should be narrower with history pane expanded.
  const historyExpandedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(historyExpandedWidth).toBeLessThan(bothCollapsedWidth);

  // Expand the debug pane too.
  await page.getByRole('button', { name: 'Expand debug pane' }).click();
  await expect(page.getByRole('tab', { name: 'Metrics' })).toBeVisible({ timeout: 3000 });

  // Center should be even narrower with both panes expanded.
  const bothExpandedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(bothExpandedWidth).toBeLessThan(historyExpandedWidth);

  // Collapse the history pane — "Collapse sidebar" mirrors the generic
  // left-pane label (vs. "Collapse debug pane" on the right).
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  const historyCollapsedWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(historyCollapsedWidth).toBeGreaterThan(bothExpandedWidth);

  // Collapse the debug pane — center should be back to full width.
  await page.getByRole('button', { name: 'Collapse debug pane' }).click();
  await expect(page.getByRole('button', { name: 'Expand debug pane' })).toBeVisible({
    timeout: 2000,
  });

  const finalWidth = await page.evaluate(
    (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0,
    centerSelector
  );
  expect(finalWidth).toBeGreaterThan(historyCollapsedWidth);
});
