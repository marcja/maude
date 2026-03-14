/**
 * src/app/api/settings/route.ts
 *
 * GET  /api/settings — returns current user settings (name, personalizationPrompt)
 * POST /api/settings — validates and persists updated settings
 *
 * This is the API boundary between the client-side settings form and the
 * server-only DB module. The settings page cannot import db.ts directly
 * because it's a client component — the 'server-only' guard would trigger
 * a build error. Instead, it fetches these endpoints.
 */

import { ValidationError, jsonResponse } from '../../../lib/server/apiHelpers';
import type { UserSettings } from '../../../lib/server/db';
import { getSettings, upsertSettings } from '../../../lib/server/db';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the raw JSON body. Both fields are required strings — the client
 * form always sends both, even when empty. This keeps the API contract simple:
 * every POST is a full replacement, not a partial patch.
 */
function validateRequestBody(body: unknown): UserSettings {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.name !== 'string') {
    throw new ValidationError('name must be a string');
  }
  if (typeof obj.personalizationPrompt !== 'string') {
    throw new ValidationError('personalizationPrompt must be a string');
  }

  return {
    name: obj.name.trim(),
    personalizationPrompt: obj.personalizationPrompt,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function GET(): Response {
  return jsonResponse(getSettings());
}

export async function POST(request: Request): Promise<Response> {
  let body: UserSettings;
  try {
    body = validateRequestBody(await request.json());
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse({ error: err.message }, 400);
    }
    throw err;
  }

  upsertSettings(body);

  return jsonResponse(body);
}
