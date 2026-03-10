'use client';

/**
 * src/components/layout/ObservabilityPane.tsx
 *
 * Debug pane that visualizes streaming metrics, events, and the system prompt.
 * Sits in a right sidebar at 300px fixed width when open; collapses to a 32px
 * strip with a vertical "Debug" label.
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
// Constants
// ---------------------------------------------------------------------------

type TabId = 'metrics' | 'events' | 'prompt';

const TABS: { id: TabId; label: string }[] = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'events', label: 'Events' },
  { id: 'prompt', label: 'System Prompt' },
];

/** Status dot color by request status. */
const STATUS_DOT_CLASS: Record<RequestStatus, string> = {
  completed: 'bg-green-500',
  stalled: 'bg-amber-500',
  error: 'bg-red-500',
  cancelled: 'bg-gray-400',
  streaming: 'bg-blue-500',
};

/**
 * Event type → badge color classes. Events not in this map get a default grey.
 * Groupings per SPEC §8: blue, green, amber, red.
 */
const EVENT_BADGE_CLASS: Record<string, string> = {
  // Blue
  message_sent: 'bg-blue-100 text-blue-800',
  conversation_loaded: 'bg-blue-100 text-blue-800',
  // Green
  stream_started: 'bg-green-100 text-green-800',
  stream_completed: 'bg-green-100 text-green-800',
  response_copied: 'bg-green-100 text-green-800',
  // Amber
  stream_stalled: 'bg-amber-100 text-amber-800',
  thinking_started: 'bg-amber-100 text-amber-800',
  thinking_completed: 'bg-amber-100 text-amber-800',
  // Red
  stream_error: 'bg-red-100 text-red-800',
  stream_cancelled: 'bg-red-100 text-red-800',
};

const DEFAULT_BADGE_CLASS = 'bg-gray-100 text-gray-800';

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
      <div className="text-xs text-gray-500">{label}</div>
      <div>{value}</div>
    </div>
  );
}

/** A single metrics card showing one request's stats. */
function MetricsCard({ request }: { request: RequestMetrics }) {
  const dotClass = STATUS_DOT_CLASS[request.status];

  return (
    <div data-testid="metrics-card" className="rounded border border-gray-200 bg-white p-2 text-sm">
      {/* Header: status badge + timestamp */}
      <div className="mb-1 flex items-center justify-between border-b border-gray-100 pb-1">
        <span className="flex items-center gap-1.5">
          <span
            data-testid="status-dot"
            className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
          />
          <span className="text-xs text-gray-600">{request.status}</span>
        </span>
        <span data-testid="card-timestamp" className="text-xs text-gray-400">
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
      <span data-testid="event-timestamp" className="w-14 shrink-0 text-gray-400">
        {formatTime(event.timestamp)}
      </span>
      <span
        data-testid="event-type"
        className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${badgeClass}`}
      >
        {event.type}
      </span>
      <span data-testid="event-payload" className="truncate text-gray-600">
        {event.payload}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ObservabilityPaneProps {
  /** Whether the pane is collapsed to a 32px strip. Controlled by the parent. */
  collapsed: boolean;
  /** Toggle between collapsed and expanded states. */
  onToggle: () => void;
}

export function ObservabilityPane({ collapsed, onToggle }: ObservabilityPaneProps) {
  const { state } = useObservability();
  const [activeTab, setActiveTab] = useState<TabId>('metrics');

  // -- Collapsed strip: 32px wide with vertical "Debug" label ----------------
  // Entire strip is clickable for discoverability — clicking anywhere expands.
  if (collapsed) {
    return (
      <button
        type="button"
        className="flex h-full w-8 cursor-pointer flex-col items-center border-l border-gray-200 bg-gray-50"
        onClick={onToggle}
        aria-label="Expand debug pane"
      >
        <span className="mt-4 text-xs text-gray-500" style={{ writingMode: 'vertical-rl' }}>
          Debug
        </span>
      </button>
    );
  }

  // -- Expanded pane: 300px fixed width --------------------------------------
  return (
    <div className="flex h-full w-[300px] flex-col border-l border-gray-200 bg-white">
      {/* Header — no internal collapse button; gear in chat header controls toggle */}
      <div className="flex items-center border-b border-gray-200 px-3 py-1.5">
        <span className="text-xs font-semibold text-gray-700">Debug</span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`flex-1 px-2 py-1.5 text-xs font-medium ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
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
  );
}

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function MetricsPanel({ requests }: { requests: RequestMetrics[] }) {
  if (requests.length === 0) {
    return <p className="py-4 text-center text-xs text-gray-400">No requests yet</p>;
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
    return <p className="py-4 text-center text-xs text-gray-400">No events yet</p>;
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
    return <p className="py-4 text-center text-xs text-gray-400">No prompt yet</p>;
  }

  return (
    <pre
      data-testid="system-prompt-pre"
      className="max-h-full overflow-y-auto break-words font-mono text-xs whitespace-pre-wrap"
    >
      {prompt}
    </pre>
  );
}
