# Playwright Patterns — Next.js 16 E2E & Component Testing

## Project structure

```
e2e/
├── fixtures/           # Custom fixtures (auth, test data)
│   ├── auth.ts
│   └── index.ts        # Re-exports all fixtures
├── pages/              # Page Object Models
│   ├── LoginPage.ts
│   ├── DashboardPage.ts
│   └── index.ts
├── tests/
│   ├── auth.spec.ts
│   ├── dashboard.spec.ts
│   └── ...
└── playwright.config.ts
```

---

## Authentication

Never log in through the UI in every test. Use `storageState` to capture an authenticated session once and reuse it.

```ts
// e2e/fixtures/auth.setup.ts
import { test as setup } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/dashboard');
  await page.context().storageState({ path: authFile });
});
```

```ts
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /auth.setup.ts/ },
    {
      name: 'authenticated',
      use: { storageState: '.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
});
```

For multiple roles (admin, viewer), create separate `storageState` files and separate Playwright projects.

---

## Page Object Model

Page Objects abstract selectors and interactions, making tests resilient to UI changes.

```ts
// e2e/pages/DashboardPage.ts
import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly createButton: Locator;
  readonly postList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createButton = page.getByRole('button', { name: /create post/i });
    this.postList = page.getByRole('list', { name: 'Posts' });
  }

  async navigate() {
    await this.page.goto('/dashboard');
  }

  async createPost(title: string) {
    await this.createButton.click();
    await this.page.getByLabel('Title').fill(title);
    await this.page.getByRole('button', { name: 'Save' }).click();
    // Wait for navigation or confirmation
    await this.page.waitForURL(/\/dashboard\/\d+/);
  }

  async getPostTitles(): Promise<string[]> {
    return this.postList.getByRole('listitem').allTextContents();
  }
}
```

```ts
// e2e/tests/dashboard.spec.ts
import { test, expect } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';

test('creates a new post', async ({ page }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.navigate();
  await dashboard.createPost('My Test Post');
  expect(await dashboard.getPostTitles()).toContain('My Test Post');
});
```

---

## Selector strategy (priority order)

Use selectors in this order of preference. The lower down the list, the more fragile:

1. **ARIA role + name**: `page.getByRole('button', { name: 'Submit' })` — best
2. **Accessible label**: `page.getByLabel('Email address')`
3. **Placeholder**: `page.getByPlaceholder('Search...')`
4. **Test ID**: `page.getByTestId('submit-btn')` — add `data-testid` to the component
5. **Text**: `page.getByText('Hello World')` — fine for static content
6. **CSS selector**: `page.locator('.submit-button')` — fragile, avoid
7. **XPath**: `page.locator('//button[@class="btn"]')` — do not use

When adding `data-testid`, use kebab-case and scope by feature: `data-testid="user-profile-avatar"` not `data-testid="avatar"`.

---

## Deterministic waits

Never use `page.waitForTimeout()`. It's slow and still flaky. Use event-based waits instead:

```ts
// ❌ Fragile
await page.waitForTimeout(2000);
expect(await page.getByText('Saved')).toBeVisible();

// ✅ Wait for the specific element
await expect(page.getByText('Saved')).toBeVisible();

// ✅ Wait for navigation
await page.waitForURL('/success');

// ✅ Wait for a specific network response
await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/posts') && resp.status() === 201),
  page.getByRole('button', { name: 'Save' }).click(),
]);

// ✅ Wait for load state
await page.waitForLoadState('networkidle');
```

---

## Network interception with `page.route()`

Use `page.route()` to mock external APIs in E2E tests. This is the Playwright-native alternative to MSW in browser context:

```ts
test('shows error when API is down', async ({ page }) => {
  await page.route('/api/user', route =>
    route.fulfill({ status: 500, body: JSON.stringify({ message: 'Server error' }) })
  );

  await page.goto('/profile');
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
});

// Simulate network failure
test('handles network timeout gracefully', async ({ page }) => {
  await page.route('/api/posts', route => route.abort('timedout'));
  await page.goto('/feed');
  await expect(page.getByText('Connection failed')).toBeVisible();
});
```

For complex handler setups, prefer `page.route()` over MSW's browser Service Worker in Playwright tests — it's simpler and has no service worker activation delay.

---

## Component testing

Playwright Component Tests run components in isolation in a real browser — without a full Next.js server. Use them for:
- Complex interactive components (drag-and-drop, rich text editors)
- Components with visual states that are hard to capture in jsdom
- Components that require real browser APIs (canvas, WebGL, clipboard)

**Not** for server components or anything requiring Next.js routing/middleware.

```tsx
// src/components/DatePicker.test.tsx (Playwright component test)
import { test, expect } from '@playwright/experimental-ct-react';
import { DatePicker } from './DatePicker';

test('selects a date', async ({ mount }) => {
  const component = await mount(<DatePicker />);
  await component.getByLabel('Open calendar').click();
  await component.getByRole('gridcell', { name: '15' }).click();
  await expect(component.getByRole('textbox')).toHaveValue('2024-01-15');
});
```

---

## Test isolation

Each test should be fully independent:

```ts
// ✅ Independent test — creates its own state
test('deletes a post', async ({ page, request }) => {
  // Create test data via API (not via UI)
  const post = await request.post('/api/posts', {
    data: { title: 'To be deleted' },
  });
  const { id } = await post.json();

  await page.goto(`/posts/${id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL('/dashboard');
  await expect(page.getByText('To be deleted')).not.toBeVisible();
});
```

Use the `request` fixture for API-level setup/teardown — it's much faster than UI interactions. Set up a test database seed endpoint or a teardown hook to clean up created data.

---

## Handling flakiness

Common sources of flakiness in Next.js + Playwright:

| Source | Fix |
|---|---|
| Hydration delay | Wait for a specific interactive element, not just `networkidle` |
| Server component streaming | `waitForLoadState('networkidle')` or wait for visible content |
| Animation/transition | Disable animations in test: `page.emulateMedia({ reducedMotion: 'reduce' })` |
| Race between route change and assertion | `page.waitForURL(pattern)` before asserting new page content |
| Parallel tests sharing state | Use test-scoped fixtures, not global state |

```ts
// Disable animations globally in playwright.config.ts
use: {
  contextOptions: {
    reducedMotion: 'reduce',
  },
},
```

---

## Parallel execution and CI

```ts
// playwright.config.ts
export default defineConfig({
  fullyParallel: true,
  workers: process.env.CI ? 2 : '50%',  // Conservative on CI, aggressive locally
  retries: process.env.CI ? 2 : 0,       // Retry on CI only
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html']],
});
```

Retries on CI mask real flakiness during development — that's intentional. Investigate any test that consistently needs retries to pass.
