/**
 * src/mocks/handlers/settings.ts
 *
 * MSW handlers for the settings API routes (/api/settings).
 * Used by Playwright E2E tests (T24) to intercept settings requests
 * without hitting the real SQLite database.
 *
 * The handlers maintain in-memory state so that a POST followed by a GET
 * (or page reload) returns the saved values — enabling the "persist on
 * reload" E2E test without a real database.
 */

import { http, HttpResponse } from 'msw';

// ---------------------------------------------------------------------------
// In-memory settings state — shared between GET and POST handlers
// ---------------------------------------------------------------------------

let settingsState = {
  name: '',
  personalizationPrompt: '',
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /api/settings — returns current in-memory settings. */
export const settingsGetHandler = http.get('/api/settings', () => {
  return HttpResponse.json(settingsState);
});

/** POST /api/settings — saves to in-memory state and returns the result. */
export const settingsPostHandler = http.post('/api/settings', async ({ request }) => {
  const body = (await request.json()) as { name: string; personalizationPrompt: string };
  settingsState = {
    name: body.name,
    personalizationPrompt: body.personalizationPrompt,
  };
  return HttpResponse.json(settingsState);
});
