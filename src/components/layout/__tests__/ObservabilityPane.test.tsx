/**
 * src/components/layout/__tests__/ObservabilityPane.test.tsx
 *
 * Tests for the ObservabilityPane debug component.
 * The pane consumes ObservabilityContext, so every test renders inside
 * ObservabilityProvider and populates state via context actions.
 *
 * Behavior under test:
 *   - Three tabs: Metrics (default), Events, System Prompt
 *   - Tab switching shows the correct panel
 *   - Collapse/expand: 32px strip with vertical "Debug" label when collapsed
 *   - Metrics tab: request cards with status badges, formatted values, empty state
 *   - Events tab: event rows with timestamp, type badge, payload, empty state
 *   - System Prompt tab: monospace <pre> block, empty state
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import {
  ObservabilityProvider,
  type RequestMetrics,
  useObservability,
} from '../../../context/ObservabilityContext';
import { ObservabilityPane } from '../ObservabilityPane';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  if (!crypto.randomUUID) {
    Object.defineProperty(crypto, 'randomUUID', {
      value: () => '',
      writable: true,
      configurable: true,
    });
  }
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    uuidCounter += 1;
    // Cast needed: mock returns a sequential string that doesn't match the
    // UUID v4 branded type, but is sufficient for deterministic test assertions.
    return `test-uuid-${uuidCounter}` as ReturnType<typeof crypto.randomUUID>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Factory for a minimal RequestMetrics with overrides. */
function makeRequest(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status: 'streaming',
    timestamp: Date.now(),
    ttft: null,
    throughput: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    ...overrides,
  };
}

/**
 * Renders ObservabilityPane inside a provider, then calls the setup function
 * to populate state via context actions.
 *
 * Why a companion component: we need to call useObservability() inside the
 * provider tree to populate state before the pane renders. The SetupBridge
 * component calls the setup function on mount via a ref-style pattern.
 *
 * @param setup  Optional callback to populate context state before assertions.
 * @param options.collapsed  Collapsed prop (default false — expanded).
 * @param options.onToggle   Toggle callback (default jest.fn()).
 */
function renderWithState(
  setup?: (ctx: ReturnType<typeof useObservability>) => void,
  options?: { collapsed?: boolean; onToggle?: () => void }
) {
  const collapsed = options?.collapsed ?? false;
  const onToggle = options?.onToggle ?? jest.fn();

  let ctxRef: ReturnType<typeof useObservability> | null = null;

  function SetupBridge({ children }: { children: ReactNode }) {
    const ctx = useObservability();
    ctxRef = ctx;
    return <>{children}</>;
  }

  const result = render(
    <ObservabilityProvider>
      <SetupBridge>
        <ObservabilityPane collapsed={collapsed} onToggle={onToggle} />
      </SetupBridge>
    </ObservabilityProvider>
  );

  const captured = ctxRef;
  if (setup && captured) {
    act(() => {
      setup(captured);
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Suite 1: Structure — tabs and default state
// ---------------------------------------------------------------------------

describe('ObservabilityPane — structure', () => {
  it('renders three tab buttons: Metrics, Events, System Prompt', () => {
    renderWithState();
    expect(screen.getByRole('tab', { name: /metrics/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /events/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /system prompt/i })).toBeInTheDocument();
  });

  it('shows the Metrics panel by default', () => {
    renderWithState();
    expect(screen.getByRole('tab', { name: /metrics/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches visible panel when a tab is clicked', async () => {
    const user = userEvent.setup();
    renderWithState();

    await user.click(screen.getByRole('tab', { name: /events/i }));
    expect(screen.getByRole('tab', { name: /events/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /metrics/i })).toHaveAttribute('aria-selected', 'false');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Collapse / expand
// ---------------------------------------------------------------------------

describe('ObservabilityPane — collapse/expand', () => {
  it('shows 32px strip with vertical "Debug" label when collapsed', () => {
    renderWithState(undefined, { collapsed: true });

    // Collapsed state: "Debug" label visible, tabs hidden
    expect(screen.getByText('Debug')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /metrics/i })).not.toBeInTheDocument();
  });

  it('shows tabs when expanded (collapsed=false)', () => {
    renderWithState(undefined, { collapsed: false });

    expect(screen.getByRole('tab', { name: /metrics/i })).toBeInTheDocument();
  });

  it('calls onToggle when the collapsed strip is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    renderWithState(undefined, { collapsed: true, onToggle });

    await user.click(screen.getByRole('button', { name: /expand/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Metrics tab — empty state
// ---------------------------------------------------------------------------

describe('ObservabilityPane — Metrics tab (empty)', () => {
  it('shows empty state message when no requests exist', () => {
    renderWithState();
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Metrics tab — request cards
// ---------------------------------------------------------------------------

describe('ObservabilityPane — Metrics tab (with data)', () => {
  const FIXED_TIMESTAMP = new Date('2024-01-15T14:32:01').getTime();

  it('renders a card for each request', () => {
    renderWithState((ctx) => {
      ctx.startRequest(makeRequest({ id: 'r1', timestamp: FIXED_TIMESTAMP }));
      ctx.startRequest(makeRequest({ id: 'r2', timestamp: FIXED_TIMESTAMP }));
    });

    const cards = screen.getAllByTestId('metrics-card');
    expect(cards).toHaveLength(2);
  });

  it.each([
    ['completed', 'bg-green-500'],
    ['stalled', 'bg-amber-500'],
    ['error', 'bg-red-500'],
    ['cancelled', 'bg-gray-400'],
    ['streaming', 'bg-blue-500'],
  ] as const)('shows %s status with correct indicator color', (status, expectedClass) => {
    renderWithState((ctx) => {
      ctx.startRequest(makeRequest({ id: 'r1', status, timestamp: FIXED_TIMESTAMP }));
    });

    const card = screen.getByTestId('metrics-card');
    const badge = within(card).getByTestId('status-dot');
    expect(badge).toHaveClass(expectedClass);
    expect(within(card).getByText(status)).toBeInTheDocument();
  });

  it('shows formatted timestamp (HH:MM:SS)', () => {
    renderWithState((ctx) => {
      ctx.startRequest(makeRequest({ id: 'r1', timestamp: FIXED_TIMESTAMP }));
    });

    // The formatted time depends on locale; check that some time string is present
    const card = screen.getByTestId('metrics-card');
    const timeEl = within(card).getByTestId('card-timestamp');
    // Should contain digits and colons like "14:32:01"
    expect(timeEl.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('shows TTFT and throughput values', () => {
    renderWithState((ctx) => {
      ctx.startRequest(
        makeRequest({
          id: 'r1',
          status: 'completed',
          timestamp: FIXED_TIMESTAMP,
          ttft: 312,
          throughput: 47,
        })
      );
    });

    const card = screen.getByTestId('metrics-card');
    expect(within(card).getByText('312 ms')).toBeInTheDocument();
    expect(within(card).getByText('47 tok/s')).toBeInTheDocument();
  });

  it('shows input/output tokens and duration', () => {
    renderWithState((ctx) => {
      ctx.startRequest(
        makeRequest({
          id: 'r1',
          status: 'completed',
          timestamp: FIXED_TIMESTAMP,
          inputTokens: 284,
          outputTokens: 163,
          durationMs: 3500,
        })
      );
    });

    const card = screen.getByTestId('metrics-card');
    expect(within(card).getByText('284 tok')).toBeInTheDocument();
    expect(within(card).getByText('163 tok')).toBeInTheDocument();
    expect(within(card).getByText('3.5s')).toBeInTheDocument();
  });

  it('rounds fractional metric values to integers', () => {
    renderWithState((ctx) => {
      ctx.startRequest(
        makeRequest({
          id: 'r1',
          status: 'completed',
          timestamp: FIXED_TIMESTAMP,
          ttft: 47948.60000002384,
          throughput: 12.345,
        })
      );
    });

    const card = screen.getByTestId('metrics-card');
    expect(within(card).getByText('47949 ms')).toBeInTheDocument();
    expect(within(card).getByText('12 tok/s')).toBeInTheDocument();
  });

  it('shows "—" for null metric values', () => {
    renderWithState((ctx) => {
      ctx.startRequest(
        makeRequest({
          id: 'r1',
          status: 'streaming',
          timestamp: FIXED_TIMESTAMP,
          // all metric fields are null by default
        })
      );
    });

    const card = screen.getByTestId('metrics-card');
    // Should have multiple "—" for TTFT, throughput, input, output, duration
    const dashes = within(card).getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Events tab — empty state
// ---------------------------------------------------------------------------

describe('ObservabilityPane — Events tab (empty)', () => {
  it('shows empty state message when no events exist', async () => {
    const user = userEvent.setup();
    renderWithState();

    await user.click(screen.getByRole('tab', { name: /events/i }));
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Events tab — event rows
// ---------------------------------------------------------------------------

describe('ObservabilityPane — Events tab (with data)', () => {
  it('renders event rows with timestamp, type badge, and payload', async () => {
    const user = userEvent.setup();
    const ts = new Date('2024-01-15T14:32:01').getTime();

    renderWithState((ctx) => {
      ctx.addEvent({
        type: 'message_sent',
        payload: '42 chars',
        timestamp: ts,
        requestId: null,
      });
    });

    await user.click(screen.getByRole('tab', { name: /events/i }));

    const row = screen.getByTestId('event-row');
    // Timestamp
    expect(within(row).getByTestId('event-timestamp').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    // Type badge
    expect(within(row).getByTestId('event-type')).toHaveTextContent('message_sent');
    // Payload
    expect(within(row).getByTestId('event-payload')).toHaveTextContent('42 chars');
  });

  it.each([
    ['message_sent', 'bg-blue-100', 'text-blue-800'],
    ['stream_completed', 'bg-green-100', 'text-green-800'],
    ['stream_stalled', 'bg-amber-100', 'text-amber-800'],
    ['stream_error', 'bg-red-100', 'text-red-800'],
    ['custom_unknown_event', 'bg-gray-100', 'text-gray-800'],
  ])('applies correct badge color for %s events', async (eventType, bgClass, textClass) => {
    const user = userEvent.setup();
    renderWithState((ctx) => {
      ctx.addEvent({
        type: eventType,
        payload: 'test',
        timestamp: Date.now(),
        requestId: null,
      });
    });

    await user.click(screen.getByRole('tab', { name: /events/i }));
    const badge = screen.getByTestId('event-type');
    expect(badge).toHaveClass(bgClass, textClass);
  });

  it('renders multiple events newest-first', async () => {
    const user = userEvent.setup();
    renderWithState((ctx) => {
      ctx.addEvent({
        type: 'message_sent',
        payload: 'first',
        timestamp: 1000,
        requestId: null,
      });
      ctx.addEvent({
        type: 'stream_completed',
        payload: 'second',
        timestamp: 2000,
        requestId: null,
      });
    });

    await user.click(screen.getByRole('tab', { name: /events/i }));

    const rows = screen.getAllByTestId('event-row');
    expect(rows).toHaveLength(2);
    // Newest first — the second addEvent call is prepended
    expect(within(rows[0]).getByTestId('event-payload')).toHaveTextContent('second');
    expect(within(rows[1]).getByTestId('event-payload')).toHaveTextContent('first');
  });
});

// ---------------------------------------------------------------------------
// Suite 7: System Prompt tab
// ---------------------------------------------------------------------------

describe('ObservabilityPane — System Prompt tab', () => {
  it('shows empty state when systemPrompt is null', async () => {
    const user = userEvent.setup();
    renderWithState();

    await user.click(screen.getByRole('tab', { name: /system prompt/i }));
    expect(screen.getByText(/no prompt yet/i)).toBeInTheDocument();
  });

  it('renders the system prompt in a monospace pre block', async () => {
    const user = userEvent.setup();
    const prompt = 'You are a helpful assistant named Alice.';

    renderWithState((ctx) => {
      ctx.setSystemPrompt(prompt);
    });

    await user.click(screen.getByRole('tab', { name: /system prompt/i }));

    const pre = screen.getByTestId('system-prompt-pre');
    expect(pre.tagName).toBe('PRE');
    expect(pre).toHaveTextContent(prompt);
    expect(pre).toHaveClass('font-mono');
  });
});
