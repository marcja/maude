# settings

Settings page route. A server component that pre-fetches current settings from SQLite and passes them to the `SettingsForm` client component.

## Files

| File | Purpose |
|------|---------|
| `page.tsx` | `/settings` -- reads settings from SQLite via `getSettings()` and renders `SettingsForm` with `initialSettings` prop |

## Architecture decisions

- **Server component pre-fetch**: Same pattern as the chat pages. The server component reads settings synchronously from SQLite and passes them as props, eliminating any loading state or fetch-on-mount in the client component.
- **No loading/error state for initial data**: Since the server component reads from a local SQLite database (synchronous, no network), the initial data is always available. Loading and error states only apply to the save operation in `SettingsForm`.

## Relationships

- **Depends on**: `src/components/settings/SettingsForm.tsx` (the client component), `src/lib/server/db.ts` (getSettings)
- **Depended on by**: The Next.js router renders this page for `/settings`

## For new engineers

- **Modify first**: `page.tsx` if you need to pre-fetch additional data (e.g., available models). The form component is in `src/components/settings/SettingsForm.tsx`.
- **Gotchas**: This is a server component. Do not add `'use client'` or hooks here.
