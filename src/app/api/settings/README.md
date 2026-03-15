# api/settings

Settings persistence endpoints bridging the client-side settings form and the server-only database module.

## Files

| File | Purpose |
|------|---------|
| `route.ts` | `GET /api/settings` -- returns current settings (name, personalizationPrompt). `POST /api/settings` -- validates and persists updated settings as a full replacement |

## Architecture decisions

- **API route instead of server actions**: The settings form is a client component that cannot import `db.ts` (guarded by `server-only`). An API route provides the bridge. Server actions could work but would add complexity for a simple read/write pair.
- **Full replacement on POST**: Both fields are always sent, even if unchanged. This keeps the API contract simple -- one POST replaces all settings, no partial patches to handle.
- **Manual validation**: Same pattern as the chat route -- manual type checks, `ValidationError` thrown on shape mismatch, caught in the handler to return 400.

## Relationships

- **Depends on**: `src/lib/server/db.ts` (getSettings, upsertSettings), `src/lib/server/apiHelpers.ts` (ValidationError, jsonResponse)
- **Depended on by**: `src/components/settings/SettingsForm.tsx` (POST on save), MSW handlers in `src/mocks/handlers/settings.ts` (mock these endpoints for E2E tests)

## For new engineers

- **Modify first**: `route.ts` -- to add a new settings field, add validation for it in `validateRequestBody()` and update the `Settings` type in `src/lib/shared/types.ts`.
- **Gotchas**: The `name` field is `.trim()`'d on save to strip leading/trailing whitespace. `personalizationPrompt` is not trimmed (whitespace may be intentional in prompt text).
