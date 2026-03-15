# app

Next.js App Router root. Contains the routing structure, root layout, global providers, and page components.

## Files

| File | Purpose |
|------|---------|
| `layout.tsx` | Root layout: wraps all pages in `ObservabilityProvider` and `MSWProvider`. Sets HTML metadata, dark theme class, and Google Fonts stylesheet link |
| `page.tsx` | Welcome page at `/`: static content with app name, description, "Start chatting" link, and "Settings" link |
| `MSWProvider.tsx` | Client component that conditionally initializes the MSW browser service worker in non-production environments. Exposes `window.__msw` for Playwright test coordination |
| `global-error.tsx` | Next.js global error boundary. Renders a minimal error page with its own `<html>`/`<body>` because the root layout is not available during global errors |
| `globals.css` | Tailwind CSS imports and custom CSS variables for the dark theme |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| [`chat/`](chat/README.md) | Chat pages: `/chat` (new conversation) and `/chat/:id` (existing conversation) |
| [`settings/`](settings/README.md) | Settings page: `/settings` |
| [`api/`](api/README.md) | API routes: chat streaming, conversations CRUD, settings read/write |

## Routing structure

```
/              -> page.tsx (Welcome)
/chat          -> chat/page.tsx (New conversation)
/chat/:id      -> chat/[id]/page.tsx (Existing conversation)
/settings      -> settings/page.tsx (Settings form)
/api/chat      -> api/chat/route.ts (POST: SSE streaming)
/api/conversations      -> api/conversations/route.ts (GET: list)
/api/conversations/:id  -> api/conversations/[id]/route.ts (GET, DELETE)
/api/settings           -> api/settings/route.ts (GET, POST)
```

## Architecture decisions

- **MSWProvider in root layout**: MSW initialization happens once at the app level, not per-page. The provider guards on `NODE_ENV !== 'production'` and uses dynamic import so the MSW bundle is tree-shaken from production builds.
- **ObservabilityProvider wraps everything**: The observability context is available to all pages so events accumulate across navigation (e.g., switching between chat conversations).
- **global-error.tsx exists to prevent prerender failures**: Without it, Next.js generates a default global-error page that fails to prerender because the root layout's client providers use hooks unavailable during static generation.

## Relationships

- **Depends on**: `src/context/ObservabilityContext.tsx` (provider in layout), `src/mocks/browser.ts` (imported by MSWProvider)
- **Depended on by**: This is the top-level routing structure -- all user-facing pages live here

## For new engineers

- **Modify first**: Add a new page directory (e.g., `app/about/page.tsx`) for new routes. Modify `layout.tsx` to add global providers or change the HTML structure.
- **Gotchas**:
  - `MSWProvider` renders its children directly (no Fragment needed in React 19). It does not block rendering while the service worker initializes -- children render immediately, and MSW intercepts become active asynchronously.
  - The `global-error.tsx` must define its own `<html>` and `<body>` tags because it replaces the root layout entirely.
