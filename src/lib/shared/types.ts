/**
 * src/lib/shared/types.ts
 *
 * Shared type definitions used by both server and client code. This module
 * exists because the server-only boundary on db.ts prevents client components
 * from importing types that originate there. Placing shared interfaces here
 * gives both sides a single source of truth without violating the boundary.
 *
 * Naming convention: these are domain types (Settings, ConversationSummary,
 * Message), not database row types. The shapes match the SQLite schema but
 * the names reflect their role in the application domain.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  name: string;
  personalizationPrompt: string;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string | null;
  created_at: number;
}
