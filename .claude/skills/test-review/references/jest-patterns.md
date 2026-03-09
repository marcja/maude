# Jest Patterns — React 19 & Next.js 16

## Concurrent Mode and Suspense

React 19 defaults to concurrent rendering. This changes test behavior in subtle ways.

### Wrapping async renders

Always wrap state updates in `act()`. In React 19, `act()` is async-by-default for concurrent renders:

```tsx
// ✅ Correct
await act(async () => {
  render(<MyComponent />);
});

// ❌ Incorrect — may produce act() warnings or stale state
render(<MyComponent />);
```

### Testing Suspense boundaries

Use `waitFor` + `findBy*` queries (async) rather than `getBy*` (sync) when a component suspends:

```tsx
render(
  <Suspense fallback={<div>Loading...</div>}>
    <AsyncComponent />
  </Suspense>
);

// Waits for resolution
const content = await screen.findByText('Hello World');
expect(content).toBeInTheDocument();

// Also verify the fallback was shown (if relevant)
// Note: you need to check this *before* awaiting resolution
```

### use() hook

The `use()` hook accepts a Promise or Context. To test a component that uses `use(somePromise)`:

```tsx
// Wrap the component in a boundary and pre-resolve the promise
const data = { id: 1, name: 'Test' };
const resolvedPromise = Promise.resolve(data);

render(
  <Suspense fallback={<div>Loading...</div>}>
    <ComponentUsingUse resource={resolvedPromise} />
  </Suspense>
);

await screen.findByText('Test');
```

For error cases, pass a rejected promise and test against an error boundary:

```tsx
const failedPromise = Promise.reject(new Error('Not found'));
// Suppress console.error for expected errors in tests
const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

render(
  <ErrorBoundary fallback={<div>Error occurred</div>}>
    <Suspense fallback={<div>Loading...</div>}>
      <ComponentUsingUse resource={failedPromise} />
    </Suspense>
  </ErrorBoundary>
);

await screen.findByText('Error occurred');
spy.mockRestore();
```

---

## Server Actions

Server Actions are async functions tagged with `'use server'`. In unit tests, test them as plain async functions, decoupled from the form binding:

```ts
// src/actions/createPost.ts
'use server';
export async function createPost(formData: FormData) {
  const title = formData.get('title') as string;
  // ... db call
}
```

```ts
// createPost.test.ts
import { createPost } from '../actions/createPost';
// Mock the db layer, not the action itself
jest.mock('../lib/db', () => ({ insert: jest.fn().mockResolvedValue({ id: 1 }) }));

it('creates a post and returns the new id', async () => {
  const formData = new FormData();
  formData.set('title', 'Hello');

  const result = await createPost(formData);
  expect(result).toEqual({ id: 1 });
});
```

**What not to do**: Don't test Server Actions by rendering a form component and submitting it — that tests the binding, not the action logic, and requires complex setup.

---

## Testing React Context providers

Wrap renders in a helper that includes all required providers. Don't repeat provider setup in every test:

```tsx
// test-utils.tsx
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';

function AllProviders({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }, // Disable retries in tests
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

const customRender = (ui: React.ReactElement, options?: RenderOptions) =>
  render(ui, { wrapper: AllProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
```

**Key detail**: create a fresh `QueryClient` per test (don't share across tests) and set `retry: false` — otherwise failed queries will retry three times in tests and cause timeouts.

---

## Mocking Next.js App Router hooks

Next.js 16 hooks (`useRouter`, `useSearchParams`, `usePathname`, `useParams`) must be mocked in Jest because they rely on the Next.js runtime:

```ts
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams('?q=test'),
  usePathname: () => '/dashboard',
  useParams: () => ({ id: '123' }),
}));
```

For dynamic router values per test:

```ts
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/current-path',
}));

it('navigates to the edit page on submit', async () => {
  render(<MyForm />);
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));
  expect(mockPush).toHaveBeenCalledWith('/edit/123');
});
```

---

## Timer mocking

For components with debounce, polling, or animated transitions:

```ts
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('debounces the search input', async () => {
  render(<SearchInput />);
  await userEvent.type(screen.getByRole('searchbox'), 'hello');

  // Nothing should have fired yet
  expect(mockSearch).not.toHaveBeenCalled();

  // Fast-forward past the debounce delay
  act(() => jest.advanceTimersByTime(300));
  expect(mockSearch).toHaveBeenCalledWith('hello');
});
```

---

## Common pitfalls

| Pitfall | Fix |
|---|---|
| `getByText` throws on async content | Use `findByText` (returns Promise) |
| `act()` warnings in console | Wrap state-triggering operations in `await act(async () => {...})` |
| Tests share state via module-level mock | Reset with `jest.resetAllMocks()` in `afterEach` |
| `useRouter` not defined | Mock `next/navigation` at top of test file |
| React Query retries causing timeout | Set `retry: false` in test `QueryClient` |
| Server component imported in Jest | Extract logic to a pure function; test that instead |
