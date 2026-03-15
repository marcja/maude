# settings

Client component for the settings form.

## Files

| File | Purpose |
|------|---------|
| `SettingsForm.tsx` | Form with Name and Personalization Prompt fields. Receives `initialSettings` from the server component parent. Saves via `POST /api/settings` using React 19's `useActionState`. Shows success banner (auto-dismiss after 3s) and error state |

## Architecture decisions

- **`useActionState` for form submission**: React 19's `useActionState` handles the async save action and provides `isSaving` for the submit button's disabled state. This replaces manual `useState` + `useEffect` patterns for form submission.
- **`defaultValue` with tracked defaults**: The form uses uncontrolled inputs with `defaultValue` for simplicity. After a save, `currentDefaults` is updated so React 19's form reset (which happens after actions) reflects the saved values, not the stale initial props.
- **Server component parent provides initial data**: `SettingsForm` receives `initialSettings` as props from the server component (`src/app/settings/page.tsx`), which reads directly from SQLite. No client-side loading state or fetch-on-mount needed.
- **Full replacement, not partial patch**: Every POST sends both fields, even if unchanged. This keeps the API contract simple -- one POST replaces all settings.

## Relationships

- **Depends on**: `src/lib/shared/types.ts` (Settings type), `/api/settings` endpoint
- **Depended on by**: `src/app/settings/page.tsx` (server component parent)

## For new engineers

- **Modify first**: `SettingsForm.tsx` to add new settings fields. Add the field to the form, update the `fetch` body, and add the corresponding field to `Settings` in `src/lib/shared/types.ts` and the API validation in `src/app/api/settings/route.ts`.
- **Gotchas**: The success banner uses a separate `showSuccess` state (not the `useActionState` state) because `useActionState`'s state can only be updated by running the action -- auto-dismiss needs independent state management.
