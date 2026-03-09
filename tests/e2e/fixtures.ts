/**
 * tests/e2e/fixtures.ts
 *
 * Shared Playwright utilities for MSW handler coordination.
 *
 * MSW is initialised in the browser by MSWProvider (src/app/MSWProvider.tsx).
 * It starts with no active handlers so development requests pass through to
 * the real API. Playwright tests activate a specific handler before each
 * interaction via useMSWHandler(), which:
 *   1. Waits for the MSW worker to mount and expose window.__msw
 *   2. Calls window.__msw.use(key) — a string-keyed call that resolves to the
 *      pre-imported handler on the browser side (no function serialisation)
 *
 * After each test, resetMSWHandlers() removes any test-specific handler so
 * subsequent tests start clean.
 */

import { type Page, expect, test } from '@playwright/test';
import type { HandlerKey } from '../../src/mocks/browser';

/**
 * Waits for the MSW service worker to initialise, then activates the named
 * handler. Must be called after page.goto() — the worker mounts on first
 * navigation.
 */
export async function useMSWHandler(page: Page, key: HandlerKey): Promise<void> {
  // The worker starts asynchronously in MSWProvider's useEffect. Wait up to
  // 5s for window.__msw to be defined before attempting to use it.
  await page.waitForFunction(() => typeof window.__msw !== 'undefined', { timeout: 5000 });
  // Pass the key as an argument (JSON-serialisable) rather than embedding it
  // in the closure string, so TypeScript and linters can validate it.
  await page.evaluate((k: HandlerKey) => window.__msw?.use(k), key);
}

/** Resets any test-specific handler, restoring the worker to its default
 * (empty) state. Call in afterEach if a test activates a handler. */
export async function resetMSWHandlers(page: Page): Promise<void> {
  await page.evaluate(() => window.__msw?.reset());
}

/**
 * Navigates to /chat, activates an MSW handler, types a message, and submits.
 * Consolidates the 4-step setup pattern shared by all chat E2E tests.
 */
export async function sendChatMessage(
  page: Page,
  handler: HandlerKey,
  text: string
): Promise<void> {
  await page.goto('/chat');
  await useMSWHandler(page, handler);
  await page.fill('[aria-label="Message input"]', text);
  await page.keyboard.press('Enter');
}

export { test, expect };
