/**
 * src/lib/server/db.ts
 *
 * Single entry point for all SQLite access. Import ONLY from server-side code —
 * Next.js enforces this via the "server-only" boundary; CLAUDE.md prohibits
 * client components from importing anything under src/lib/server/.
 *
 * better-sqlite3 is synchronous by design. This is intentional: Next.js API
 * routes run in Node.js where synchronous I/O on a local file is faster than
 * the async overhead of a remote database driver, and it eliminates a whole
 * class of async/await bugs in query code.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSettings {
  name: string;
  personalizationPrompt: string;
}

export interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

// DB_PATH is overridden in tests to ':memory:' so no filesystem access is needed.
const dbPath = process.env.DB_PATH ?? '/data/chat.db';

export const db = new Database(dbPath);

// Foreign key enforcement is off by default in SQLite — enable it so that
// ON DELETE CASCADE on messages.conversation_id is actually respected.
db.pragma('foreign_keys = ON');

// Run the migration synchronously at module load time. Using readFileSync here
// (rather than a dynamic import or require) keeps the initialization path simple
// and avoids introducing async state into module startup.
//
// process.cwd() instead of __dirname: Next.js webpack rewrites __dirname to
// the bundle output directory, making it point to .next/ rather than src/.
// process.cwd() reliably gives the project root in both dev and production.
const migrationSql = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'server', 'migrations', '001_initial.sql'),
  'utf8'
);
db.exec(migrationSql);

// ---------------------------------------------------------------------------
// Prepared statements — cached at module level so SQL is compiled once, not
// on every call. better-sqlite3 parses and compiles SQL in prepare(); reusing
// the same Statement object eliminates that overhead on every request.
// updateConversation is excluded because it builds SQL dynamically.
// ---------------------------------------------------------------------------

const stmtGetSettings = db.prepare('SELECT key, value FROM settings');
const stmtUpsertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
// Transaction wraps two writes for atomicity — a failure between them would leave
// settings in a partial state. Single-statement functions below don't need
// transactions because SQLite guarantees each statement is atomic on its own.
const txUpsertSettings = db.transaction((s: UserSettings) => {
  stmtUpsertSetting.run('name', s.name);
  stmtUpsertSetting.run('personalizationPrompt', s.personalizationPrompt);
});
const stmtCreateConversation = db.prepare(
  'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
);
const stmtGetConversations = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC');
const stmtGetConversation = db.prepare('SELECT * FROM conversations WHERE id = ?');
const stmtDeleteConversation = db.prepare('DELETE FROM conversations WHERE id = ?');
const stmtInsertMessage = db.prepare(
  `INSERT INTO messages (id, conversation_id, role, content, thinking, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const stmtGetMessages = db.prepare(
  'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
);

// ---------------------------------------------------------------------------
// Settings queries
// ---------------------------------------------------------------------------

export function getSettings(): UserSettings {
  // better-sqlite3's .all() returns `unknown[]` because the library cannot
  // infer column types from SQL strings. The shape is guaranteed by the
  // settings table schema (key TEXT, value TEXT) defined in 001_initial.sql.
  const rows = stmtGetSettings.all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    name: map.name ?? '',
    personalizationPrompt: map.personalizationPrompt ?? '',
  };
}

export function upsertSettings(settings: UserSettings): void {
  txUpsertSettings(settings);
}

// ---------------------------------------------------------------------------
// Conversation queries
// ---------------------------------------------------------------------------

export function createConversation(id: string, title: string, now: number): void {
  stmtCreateConversation.run(id, title, now, now);
}

export function updateConversation(
  id: string,
  fields: Partial<{ title: string; updated_at: number }>
): void {
  // Build SET clause dynamically from whichever fields are provided.
  // This avoids overwriting untouched columns with undefined values.
  // Cannot use a cached statement here because the SET clause varies.
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (fields.title !== undefined) {
    sets.push('title = ?');
    values.push(fields.title);
  }
  if (fields.updated_at !== undefined) {
    sets.push('updated_at = ?');
    values.push(fields.updated_at);
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getConversations(): ConversationRow[] {
  // better-sqlite3 returns `unknown[]`; shape matches the conversations table
  // schema (id, title, created_at, updated_at) defined in 001_initial.sql.
  return stmtGetConversations.all() as ConversationRow[];
}

export function getConversation(id: string): ConversationRow | undefined {
  // better-sqlite3's .get() returns `unknown`; the WHERE clause guarantees at
  // most one row, and the shape matches ConversationRow from 001_initial.sql.
  return stmtGetConversation.get(id) as ConversationRow | undefined;
}

export function deleteConversation(id: string): void {
  stmtDeleteConversation.run(id);
}

// ---------------------------------------------------------------------------
// Message queries
// ---------------------------------------------------------------------------

export function insertMessage(msg: MessageRow): void {
  stmtInsertMessage.run(
    msg.id,
    msg.conversation_id,
    msg.role,
    msg.content,
    msg.thinking,
    msg.created_at
  );
}

export function getMessages(conversationId: string): MessageRow[] {
  // better-sqlite3 returns `unknown[]`; shape matches the messages table
  // schema (id, conversation_id, role, content, thinking, created_at).
  return stmtGetMessages.all(conversationId) as MessageRow[];
}
