'use client';

/**
 * src/components/layout/ObservabilityPane.tsx
 *
 * Debug pane that visualizes streaming metrics, events, and the system prompt.
 * Sits in a right sidebar at 300px fixed width when open; collapses to a narrow
 * strip with a toggle icon inside (matching the left sidebar pattern).
 *
 * Design decisions:
 *
 * - Reads entirely from ObservabilityContext — no props needed. The context is
 *   the single source of truth for all observability data.
 *
 * - Three tabs (Metrics, Events, System Prompt) match the three slices of
 *   ObservabilityState. Each tab panel is a simple render of its data slice.
 *
 * - Sub-components (MetricsCard, EventRow) are file-internal — they're
 *   layout-specific and not intended for reuse outside this pane.
 *
 * - Event badge and status dot colors are defined as lookup maps so the
 *   mapping from domain values to Tailwind classes is centralized and testable.
 *
 * - Metric values that are null (still streaming) display as "—" so the card
 *   layout stays stable while data arrives progressively.
 */

import { useState } from 'react';
import {
  type ObservabilityEvent,
  type RequestMetrics,
  type RequestStatus,
  useObservability,
} from '../../context/ObservabilityContext';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function DebugIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <title>Debug</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabId = 'metrics' | 'events' | 'prompt';

const TABS: { id: TabId; label: string }[] = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'events', label: 'Events' },
  { id: 'prompt', label: 'Prompt' },
];

/** Status dot color by request status. */
const STATUS_DOT_CLASS: Record<RequestStatus, string> = {
  completed: 'bg-green-500',
  stalled: 'bg-amber-500',
  error: 'bg-red-500',
  cancelled: 'bg-content-faint',
  streaming: 'bg-accent',
};

/**
 * Event type → badge color classes. Events not in this map get a default grey.
 * Groupings per SPEC §8: blue, green, amber, red.
 */
const EVENT_BADGE_CLASS: Record<string, string> = {
  // Blue
  message_sent: 'bg-blue-500/20 text-blue-300',
  conversation_loaded: 'bg-blue-500/20 text-blue-300',
  // Green
  stream_started: 'bg-green-500/20 text-green-300',
  stream_completed: 'bg-green-500/20 text-green-300',
  response_copied: 'bg-green-500/20 text-green-300',
  // Amber
  stream_stalled: 'bg-amber-500/20 text-amber-300',
  thinking_started: 'bg-amber-500/20 text-amber-300',
  thinking_completed: 'bg-amber-500/20 text-amber-300',
  // Red
  stream_error: 'bg-red-500/20 text-red-300',
  stream_cancelled: 'bg-red-500/20 text-red-300',
};

const DEFAULT_BADGE_CLASS = 'bg-surface-overlay text-content-muted';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a timestamp as HH:MM:SS in 24-hour format. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

/** Format a numeric metric value with a unit, or "—" if null. */
function formatMetric(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${Math.round(value)} ${unit}`;
}

/** Format duration in ms as seconds with one decimal, or "—" if null. */
function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Label + value pair used inside MetricsCard grids. */
function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-content-faint">{label}</div>
      <div className="text-content">{value}</div>
    </div>
  );
}

/** A single metrics card showing one request's stats. */
function MetricsCard({ request }: { request: RequestMetrics }) {
  const dotClass = STATUS_DOT_CLASS[request.status];

  return (
    <div
      data-testid="metrics-card"
      className="rounded-lg border border-edge bg-surface-raised p-2 text-sm"
    >
      {/* Header: status badge + timestamp */}
      <div className="mb-1 flex items-center justify-between border-b border-edge pb-1">
        <span className="flex items-center gap-1.5">
          <span
            data-testid="status-dot"
            data-status={request.status}
            className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
          />
          <span className="text-xs text-content-muted">{request.status}</span>
        </span>
        <span data-testid="card-timestamp" className="text-xs text-content-faint">
          {formatTime(request.timestamp)}
        </span>
      </div>

      {/* Row 1: TTFT + Throughput (2-column grid) */}
      <div className="mt-1 grid grid-cols-2 gap-x-2">
        <MetricCell label="TTFT" value={formatMetric(request.ttft, 'ms')} />
        <MetricCell label="Throughput" value={formatMetric(request.throughput, 'tok/s')} />
      </div>

      {/* Row 2: In + Out + Duration (3-column grid) */}
      <div className="mt-1 grid grid-cols-3 gap-x-2">
        <MetricCell label="In" value={formatMetric(request.inputTokens, 'tok')} />
        <MetricCell label="Out" value={formatMetric(request.outputTokens, 'tok')} />
        <MetricCell label="Duration" value={formatDuration(request.durationMs)} />
      </div>
    </div>
  );
}

/** A single event row in the Events tab. */
function EventRow({ event }: { event: ObservabilityEvent }) {
  const badgeClass = EVENT_BADGE_CLASS[event.type] ?? DEFAULT_BADGE_CLASS;

  return (
    <div data-testid="event-row" className="flex items-center gap-2 py-0.5 text-xs">
      <span data-testid="event-timestamp" className="w-14 shrink-0 text-content-faint">
        {formatTime(event.timestamp)}
      </span>
      <span
        data-testid="event-type"
        data-event-category={event.type}
        className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${badgeClass}`}
      >
        {event.type}
      </span>
      <span data-testid="event-payload" className="truncate text-content-muted">
        {event.payload}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ObservabilityPaneProps {
  /** Whether the pane is collapsed to a narrow strip. Controlled by the parent. */
  collapsed: boolean;
  /** Toggle between collapsed and expanded states. */
  onToggle: () => void;
}

export function ObservabilityPane({ collapsed, onToggle }: ObservabilityPaneProps) {
  const { state } = useObservability();
  const [activeTab, setActiveTab] = useState<TabId>('metrics');

  // -- Collapsed strip: icon-based toggle inside the tray ---------------------
  // Matches left sidebar pattern — icon inside the strip, not rotated text.
  // Hidden on mobile — only the expanded overlay is available on small screens.
  if (collapsed) {
    return (
      <div
        className="hidden sm:flex h-full w-14 flex-col items-center border-l border-edge-hover bg-surface-dim py-3"
        aria-label="Debug pane"
      >
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
          onClick={onToggle}
          aria-label="Expand debug pane"
        >
          <DebugIcon />
        </button>
      </div>
    );
  }

  // -- Expanded pane: overlay on mobile, side-by-side at sm: and above --------
  return (
    <>
      {/* Backdrop — mobile only. Tap to dismiss the overlay. */}
      <div
        className="fixed inset-0 z-40 bg-black/50 sm:hidden"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onToggle();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close debug pane"
      />
      <div className="fixed inset-y-0 right-0 z-50 sm:relative sm:z-auto flex h-full w-[300px] flex-col border-l border-edge bg-surface-dim transition-transform duration-200 sm:transition-all sm:duration-200 sm:ease-out">
        {/* Header with collapse toggle inside — matches left sidebar sizing */}
        <div className="flex items-center gap-2 border-b border-edge px-3 py-3">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
            onClick={onToggle}
            aria-label="Collapse debug pane"
          >
            <DebugIcon />
          </button>
          <span className="text-sm text-content-muted">Debug</span>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-edge" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`flex-1 px-2 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-content-faint hover:text-content-muted'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div className="flex-1 overflow-y-auto p-2">
          {activeTab === 'metrics' && <MetricsPanel requests={state.requests} />}
          {activeTab === 'events' && <EventsPanel events={state.events} />}
          {activeTab === 'prompt' && <SystemPromptPanel prompt={state.systemPrompt} />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function MetricsPanel({ requests }: { requests: RequestMetrics[] }) {
  if (requests.length === 0) {
    return <p className="py-4 text-center text-xs text-content-faint">No requests yet</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {requests.map((req) => (
        <MetricsCard key={req.id} request={req} />
      ))}
    </div>
  );
}

function EventsPanel({ events }: { events: ObservabilityEvent[] }) {
  if (events.length === 0) {
    return <p className="py-4 text-center text-xs text-content-faint">No events yet</p>;
  }

  return (
    <div>
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </div>
  );
}

function SystemPromptPanel({ prompt }: { prompt: string | null }) {
  if (prompt === null) {
    return <p className="py-4 text-center text-xs text-content-faint">No prompt yet</p>;
  }

  return (
    <pre
      data-testid="system-prompt-pre"
      className="max-h-full overflow-y-auto break-words font-mono text-xs text-content-muted whitespace-pre-wrap"
    >
      {prompt}
    </pre>
  );
}
